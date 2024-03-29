const axios = require('axios');
const { pool, sqlFormat } = require('../mariadb');
const mybatisMapper = require('mybatis-mapper');
const moment = require('moment-timezone');

const slotKey = process.env.HL_API_KEY_SLOT;
const casinoKey = process.env.HL_API_KEY_CASINO;

// #region SD private functions
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUserInfo(user) {
  let conn = await pool.getConnection();
  let params = { id: user };

  let getUserInfo = mybatisMapper.getStatement('user', 'getUserInfo', params, sqlFormat);

  try {
    let result = await conn.query(getUserInfo);
    let userInfo = { id: user, nickname: result[0].nickname };
    return userInfo;
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}

async function insertHlAccount(params, apiKey) {
  let conn = await pool.getConnection();
  let insertApiAccount;

  if (apiKey === slotKey) {
    insertApiAccount = mybatisMapper.getStatement('user', 'insertHlSlotAccount', params, sqlFormat);
  } else if (apiKey === casinoKey) {
    insertApiAccount = mybatisMapper.getStatement('user', 'insertHlCasinoAccount', params, sqlFormat);
  }

  try {
    await conn.query(insertApiAccount);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

const BATCH_SIZE = 1000; // 더 작거나 큰 수로 조정 가능

async function insertGameList(gameList) {
  console.log(`게임리스트 업데이트 시작`);

  // 1. gameList를 배치 크기로 분할
  const batches = [];
  for (let i = 0; i < gameList.length; i += BATCH_SIZE) {
    batches.push(gameList.slice(i, i + BATCH_SIZE));
  }

  // 2. 각 배치에 대해 처리
  for (const batch of batches) {
    let conn = await pool.getConnection();
    try {
      const filteredBatch = batch.filter((game) => game.thumbnail && !game.thumbnail.includes("'"));

      let params = { games: filteredBatch };
      let insertGameList = mybatisMapper.getStatement('game', 'insertHlGameList', params, sqlFormat);

      await conn.query(insertGameList);
    } catch (e) {
      console.error('Error:', e);
      console.error('Error stack:', e.stack); // 스택 트레이스도 출력합니다.
      throw e;
    } finally {
      if (conn) conn.release();
    }
  }
  console.log(`게임리스트 업데이트 완료`);
}

// #region HL Detail Log
let processedSlotBetIds = new Map();
let processedCasinoBetIds = new Map();

async function getBetHistory(apiKey) {
  let intervalTime = 20;
  let localTime = {
    start: moment().tz('Asia/Seoul').subtract(intervalTime, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    end: moment().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss'),
  };
  let time = {
    start: moment().utc().subtract(intervalTime, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    end: moment().utc().format('YYYY-MM-DD HH:mm:ss'),
  };

  if (apiKey === slotKey) {
    console.log(`[베팅내역 요청] 슬 롯 : [시작]${localTime.start} ~ [종료]${localTime.end}`);
  } else if (apiKey === casinoKey) {
    console.log(`[베팅내역 요청] 카지노: [시작]${localTime.start} ~ [종료]${localTime.end}`);
  }

  let postData = {
    start: time.start,
    end: time.end,
    page: 1,
    perPage: 1000,
    withDetails: 1,
    order: 'asc',
  };

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/transactions`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  try {
    let newData;

    const response = await axios(config);
    const data = response.data.data;

    if (apiKey === slotKey) {
      newData = processBetData(processedSlotBetIds, data);
    } else if (apiKey === casinoKey) {
      newData = processBetData(processedCasinoBetIds, data);
    }

    const processedData = newData.map((item) => {
      const isTie = item.external?.detail?.data?.result?.outcome === 'Tie';

      return {
        ...item,
        transaction_type: isTie ? 'tie' : item.type,
      };
    });

    return processedData;
  } catch (error) {
    console.log('[HL API]베팅내역 가져오기 실패');
    console.error(error);
    return [];
  }
}

function processBetData(processedBetIds, data) {
  const now = Date.now();
  const twentyMinutes = 20 * 60 * 1000;

  processedBetIds.forEach((value, key) => {
    if (now - value > twentyMinutes) {
      processedBetIds.delete(key);
    }
  });

  let newData = data.filter((item) => {
    if (item.type !== 'bet' && item.type !== 'win') {
      return false;
    }

    if (item.details.game.type !== 'slot' && item.external.detail == null) {
      return false;
    }

    return !processedBetIds.has(item.id);
  });

  newData.forEach((item) => processedBetIds.set(item.id, now));

  return newData;
}

async function insertDetailHlLog(betHistory, apiKey) {
  let conn = await pool.getConnection();

  let params = { betHistory: betHistory };

  let insertBetHistory = mybatisMapper.getStatement('log', 'insertDetailHlLog', params, sqlFormat);

  try {
    let result = await conn.query(insertBetHistory);
    if (apiKey === slotKey) {
      console.log(`[베팅내역 응답] 슬 롯 : 업데이트 완료: 받아온 [${betHistory.length}]개 내역 중 [${result.affectedRows}]개 업데이트`);
    } else if (apiKey === casinoKey) {
      console.log(`[베팅내역 응답] 카지노: 업데이트 완료: 받아온 [${betHistory.length}]개 내역 중 [${result.affectedRows}]개 업데이트`);
    }
  } catch (e) {
    console.log(e);
    throw e;
  } finally {
    if (conn) conn.release();
  }
}
// #endregion

// #endregion

// #region export functions
function createUser(params, apiKey) {
  let postData = {
    username: params.new_id || params.id || params.아이디,
    nickname: params.new_nickname || params.닉네임 || params.nick,
  };

  const config = {
    method: 'post',
    url: `${process.env.HL_API_ENDPOINT}/user/create`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  axios(config)
    .then((result) => {
      if (result.status == 200) {
        insertHlAccount(result.data, apiKey);
        if (apiKey === slotKey) {
          console.log(`[HL_SLOT_API]유저생성 성공: ID: ${result.data.username}`);
        } else if (apiKey === casinoKey) {
          console.log(`[HL_CASINO_API]유저생성 성공: ID: ${result.data.username}`);
        }
      }
    })
    .catch((error) => {
      console.log(error.response.data);
      if (apiKey === slotKey) {
        console.log(`[HL_SLOT_API]유저생성 실패: ID: ${params.아이디}`);
      } else if (apiKey === casinoKey) {
        console.log(`[HL_CASINO_API]유저생성 실패: ID: ${params.아이디}`);
      }
    });
}

async function checkUserApiType(id) {
  let userAPiType;

  let slotResult = await updateUserBalance(id, slotKey);
  let slotBalance = slotResult.balance;

  let casinoResult = await updateUserBalance(id, casinoKey);
  let casinoBalance = casinoResult.balance;

  if (slotBalance > casinoBalance) {
    userAPiType = 's';
  } else if (slotBalance < casinoBalance) {
    userAPiType = 'c';
  } else {
    userAPiType = 's';
  }

  await swapUserApiType(id, userAPiType);

  let userInfo = { userApiType: userAPiType, slotBalance: slotBalance, casinoBalance: casinoBalance };
  return userInfo;
}

async function requestAsset(params) {
  let url;

  if (params.reqType == 'give' || params.reqType == 'take') {
    params.id = params.receiverId;
    params.nick = params.receiverNick;
  }

  let { userApiType, slotBalance, casinoBalance } = await checkUserApiType(params.id);
  // console.log(
  //   `[시작] ID: ${params.id} / 유저API타입: ${userApiType === 'c' ? '카지노' : '슬롯'} / 슬롯밸런스: ${slotBalance.toLocaleString(
  //     'ko-KR'
  //   )} / 카지노밸런스: ${casinoBalance.toLocaleString('ko-KR')}`
  // );

  if (userApiType === 'c') {
    if (casinoBalance > 0) {
      await allBalanceWithdrawFromCasino(params.id);
    }
    await swapUserApiType(params.id, 's');
  }

  let updatedInfo = await checkUserApiType(params.id);
  userApiType = updatedInfo.userApiType;
  slotBalance = updatedInfo.slotBalance;
  casinoBalance = updatedInfo.casinoBalance;

  // console.log(
  //   `[중간] ID: ${params.id} / 유저API타입: ${userApiType === 'c' ? '카지노' : '슬롯'} / 슬롯밸런스: ${slotBalance.toLocaleString(
  //     'ko-KR'
  //   )} / 카지노밸런스: ${casinoBalance.toLocaleString('ko-KR')}`
  // );

  if (params.타입 == '입금' || params.type == '지급' || params.type == '출금취소') {
    url = `${process.env.HL_API_ENDPOINT}/user/add-balance`;
  } else if (params.타입 == '출금' || params.type == '회수') {
    if (params.reqMoney > slotBalance) {
      params.reqMoney = slotBalance;
    }
    url = `${process.env.HL_API_ENDPOINT}/user/sub-balance`;
  }

  let postData = {
    username: params.id,
    amount: parseInt(params.reqMoney) + parseInt(params.bonusMoney || 0),
  };

  const config = {
    method: 'post',
    url: url,
    headers: { Authorization: `Bearer ${slotKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  try {
    // await delay(1000);
    let apiResult = await axios(config);
    let { userApiType, slotBalance, casinoBalance } = await checkUserApiType(params.id);
    // console.log(
    //   `[끝] ID: ${params.id} / 유저API타입: ${userApiType === 'c' ? '카지노' : '슬롯'} / 슬롯밸런스: ${slotBalance.toLocaleString(
    //     'ko-KR'
    //   )} / 카지노밸런스: ${casinoBalance.toLocaleString('ko-KR')}`
    // );

    if (params.senderId) {
      console.log(
        `[${params.type}완료] 신청: ${params.senderId} / 대상: ${params.id} / 금액: ${parseInt(params.reqMoney + params.reqBonus).toLocaleString('ko-KR')}`
      );
    } else {
      console.log(`[${params.타입}완료] 대상: ${params.id} / 금액: ${parseInt(params.reqMoney + params.reqBonus).toLocaleString('ko-KR')}`);
    }
    let userBalance = { userApiType: userApiType, slotBalance: slotBalance, casinoBalance: casinoBalance };
    userBalance.id = params.id;

    return apiResult;
  } catch (error) {
    console.log(`[HL_API] ${params.타입 || params.type}처리 실패: ID: ${params.id}`);
    console.log(`응답코드: ${error.response.status}`);
    console.log(`응답메세지: ${error.response.data.message}`);
    console.log(`${params.타입 || params.type}처리 실패: ID: ${params.id}`);
    return error.response;
  }
}

// #region CASINO -> SLOT 보유금 이동
async function allBalanceWithdrawFromCasino(id) {
  let postData = {
    username: id,
  };

  const config = {
    method: 'post',
    url: `${process.env.HL_API_ENDPOINT}/user/sub-balance-all`,
    headers: { Authorization: `Bearer ${casinoKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  try {
    const result = await axios(config);
    // console.log('카지노출금값', result.data.amount);
    delay(1000);
    await allBalanceDepositToSlot(result.data.username, Math.abs(result.data.amount)); // await 추가
  } catch (error) {
    console.log(error);
  }
}

async function allBalanceDepositToSlot(id, balance) {
  let postData = {
    username: id,
    amount: balance,
  };

  const config = {
    method: 'post',
    url: `${process.env.HL_API_ENDPOINT}/user/add-balance`,
    headers: { Authorization: `Bearer ${slotKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  await axios(config)
    .then((result) => {
      console.log(`[보유금 전환] ${result.data.username}의 카지노 보유금 ${result.data.amount}원을 슬롯 보유금으로 전환완료`);
    })
    .catch((error) => {
      console.log(error.response.data);
    });
}

async function swapUserApiType(id, apiType) {
  let conn = await pool.getConnection();

  let params = { id: id, api_type: apiType };
  let updateUserApiType = mybatisMapper.getStatement('user', 'updateUserApiType', params, sqlFormat);

  try {
    await conn.query(updateUserApiType);
    // console.log(`[API TYPE] ${id}의 API 타입을 SLOT으로 변경 완료`);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}
// #endregion

async function checkUserBalance(user, userApiType) {
  let apiKey = userApiType === 'slot' ? slotKey : casinoKey;

  let postData = {
    username: user,
  };

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/user`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  let params = {};
  params.id = user;

  try {
    const result = await axios(config);
    params.balance = result.data.balance;
    params.status = result.status;

    return params;
  } catch (error) {
    console.log(error);
    if (apiKey === slotKey) {
      console.log(`[HL_SLOT_API] 유저 밸런스 업데이트 실패: [${params.id}]유저 없음`);
    } else if (apiKey === casinoKey) {
      console.log(`[HL_CASINO_API] 유저 밸런스 업데이트 실패: [${params.id}]유저 없음`);
    }

    let userInfo = await getUserInfo(user);
    createUser(userInfo, slotKey);
    createUser(userInfo, casinoKey);
    return params;
  }
}

async function updateUserBalance(user, apiKey) {
  let postData = {
    username: user,
  };

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/user`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  let params = {};
  params.id = user;

  try {
    const result = await axios(config);
    params.balance = result.data.balance;
    params.status = result.status;
    // if (apiKey === slotKey) {
    //   console.log(`[HL_SLOT_API] 유저 밸런스 업데이트 성공: [${params.id}]`);
    // } else if (apiKey === casinoKey) {
    //   console.log(`[HL_CASINO_API] 유저 밸런스 업데이트 성공: [${params.id}]`);
    // }

    return params;
  } catch (error) {
    console.log(`[HL_SLOT_API] 유저 밸런스 업데이트 실패: [${params.id}]`);
    if (error.response.status === 422) {
      let userInfo = await getUserInfo(user);
      createUser(userInfo, slotKey);
      createUser(userInfo, casinoKey);
    }
  }
}

async function updateAllUserBalance(apiKey) {
  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/user-list`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  };

  try {
    const result = await axios(config);
    return result.data;
  } catch (error) {
    if (apiKey === slotKey) {
      console.log(`[HL_SLOT_API] 전체유저 밸런스 업데이트 실패`, error);
    } else if (apiKey === casinoKey) {
      console.log(`[HL_CASINO_API] 전체유저 밸런스 업데이트 실패`, error);
    }
  }
}

async function updateAdminBalance(type, apiKey) {
  let params = {};

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/my-info`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  };

  await axios(config)
    .then((result) => {
      params.id = 'admin';
      params.balance = Math.floor(parseFloat(result.data.balance));
    })
    .catch((error) => {
      console.log(error);
      return;
    });

  if (params.balance !== undefined) {
    let conn;
    try {
      conn = await pool.getConnection();
      let sql;
      if (type === 'slot') {
        sql = mybatisMapper.getStatement('log', 'updateAdminSlotBalance', params, sqlFormat);
      } else if (type === 'casino') {
        sql = mybatisMapper.getStatement('log', 'updateAdminCasinoBalance', params, sqlFormat);
      }
      await conn.query(sql);
    } catch (e) {
      console.log(e);
      return done(e);
    } finally {
      if (conn) conn.release();
    }
  } else {
    if (type === 'slot') {
      console.log('[HL_SLOT_API] 관리자의 보유금 정보를 받아오지 못했습니다');
    } else if (type === 'casino') {
      console.log('[HL_CASINO_API] 관리자의 보유금 정보를 받아오지 못했습니다');
    }
  }
}

// updateGameList는 무조건 SLOT API로 처리
async function updateGameList(type) {
  let gameList = [];
  let apiKey;
  if (type === 'slot') {
    apiKey = slotKey;
  } else if (type === 'casino') {
    apiKey = casinoKey;
  }

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/game-list`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    // data: postData,
  };
  await axios(config)
    .then((result) => {
      // gameList = result.data.slice(28, 29);
      gameList = result.data;
    })
    .catch((error) => {
      console.log(error);
    });

  if (gameList !== undefined) {
    for (let game of gameList) {
      if (game.langs == null) {
        game.langs = { ko: '' };
      }
      game.title = game.title.replace(/'/g, '').trim();
      game.langs.ko = game.langs.ko.replace(/'/g, '').trim();
    }
    await insertGameList(gameList);
  }
}

async function isTie(betting) {
  if (!betting.external || betting.external?.detail?.data?.result?.outcome !== 'Tie') return false;

  let participants = betting.external?.detail?.data?.participants || [];

  if (participants.length === 0) return false;

  for (let participant of participants) {
    let bets = participant.bets || [];
    if (bets.length === 0) return false;

    for (let bet of bets) {
      if (bet.stake !== bet.payout) return false; // Do not filter if stake and payout are not equal
    }
  }
  return true; // Filter out if outcome is 'Tie' and stake and payout are equal
}

async function requestDetailLog(apiKey, type) {
  let newBetArr = [];
  let getBetArr = await getBetHistory(apiKey);
  let apiType = type === 'slot' ? '[베팅내역 응답] 슬 롯 :' : '[베팅내역 응답] 카지노:';

  if (getBetArr === undefined || getBetArr.length === 0) {
    console.log(`${apiType} 새로운 베팅내역 없음`);
    return;
  }

  let mappedBetArr = getBetArr.map((betting) => ({
    created_date: moment(betting.processed_at).format('YYYY-MM-DD HH:mm:ss'),
    transaction_id: betting.id,
    round_id: betting.details.game.round,
    username: betting.user.username,
    provider_name: betting.details.game.vendor,
    category: betting.details.game.type === 'slot' ? 'slot' : betting.details.game.type === 'live-sport' ? 'live-sport' : 'casino',
    game_id: betting.details.game.id,
    game_title: betting.details.game.title.replace(/'/g, ''),
    transaction_type: betting.transaction_type,
    transaction_amount: betting.amount,
    previous_balance: betting.before,
    available_balance: betting.before + betting.amount,
  }));

  let betUsers = [...new Set(mappedBetArr.map((betting) => betting.username))];

  if (mappedBetArr.length > 0) {
    await insertDetailHlLog(mappedBetArr, apiKey);
  }

  return betUsers;
}

// #endregion

module.exports = {
  createUser,
  requestAsset,
  checkUserBalance,
  updateUserBalance,
  updateAllUserBalance,
  updateAdminBalance,
  requestDetailLog,
  updateGameList,
  getBetHistory,
};
