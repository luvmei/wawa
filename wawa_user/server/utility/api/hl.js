const axios = require('axios');
const mybatisMapper = require('mybatis-mapper');
const { pool, sqlFormat } = require('../mariadb');

const slotKey = process.env.HL_API_KEY_SLOT;
const casinoKey = process.env.HL_API_KEY_CASINO;

// #region HL private functions
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

async function swapApiBalance(userApiType, id) {
  let apiKey = userApiType === 's' ? slotKey : casinoKey;

  let postData = {
    username: id,
  };

  const config = {
    method: 'post',
    url: `${process.env.HL_API_ENDPOINT}/user/sub-balance-all`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  await axios(config)
    .then((result) => {
      // console.log(`[API_밸런스전환] 회원ID: ${id}`);
      // console.log(`${userApiType === 's' ? '슬롯' : '카지노'} 보유금 / ${Math.abs(result.data.amount).toLocaleString('ko-KR')}원 전환대기`);
      allBalanceDeposit(result.data.username, Math.abs(result.data.amount), userApiType);
    })
    .catch((error) => {
      console.log(error.response.data);
    });
}

async function allBalanceDeposit(id, balance, userApiType) {
  // console.log(`전체출금한금액: ${balance}`);
  let gameType = userApiType === 's' ? 'c' : 's';
  let apiKey = userApiType === 's' ? casinoKey : slotKey;

  let postData = {
    username: id,
    amount: balance,
  };

  const config = {
    method: 'post',
    url: `${process.env.HL_API_ENDPOINT}/user/add-balance`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  await axios(config)
    .then((result) => {
      console.log(
        `[보유금 전환] ${userApiType === 's' ? '슬롯' : '카지노'}에서 ${userApiType === 's' ? '카지노로' : '슬롯으로'} ${result.data.amount.toLocaleString(
          'ko-KR'
        )}원 전환완료`
      );
      swapUserApiType(result.data.username, gameType);
    })
    .catch((error) => {
      console.log(error.response.data);
    });
}

async function swapUserApiType(id, gameType) {
  let conn = await pool.getConnection();

  let params = { id: id, api_type: gameType };
  let updateUserApiType = mybatisMapper.getStatement('user', 'updateUserApiType', params, sqlFormat);

  try {
    await conn.query(updateUserApiType);
    // console.log(`[API타입변경] 회원ID: ${id} / API타입: ${gameType === 's' ? '슬롯' : '카지노'}`);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}
// #endregion

// #region HL export functions
async function requestGameUrl(req, res) {
  let apiKey;
  let { userApiType, slotBalance, casinoBalance } = await checkUserApiType(req.user[0].id);
  console.log(
    `[회원API 정보] 회원ID: ${req.user[0].id}, 카지노머니: ${casinoBalance.toLocaleString('ko-KR')} / 슬롯머니: ${slotBalance.toLocaleString(
      'ko-KR'
    )} / API타입: ${userApiType === 's' ? '슬롯' : '카지노'}`
  );

  if (req.body.gameType == 'slot') {
    gameType = 's';
    apiKey = slotKey;
  } else if (req.body.gameType == 'casino') {
    gameType = 'c';
    apiKey = casinoKey;
  }

  if (gameType !== userApiType) {
    if (slotBalance != 0 || casinoBalance != 0) {
      await swapApiBalance(userApiType, req.user[0].id);
    } else {
      await swapUserApiType(req.user[0].id, gameType);
    }
  }

  // //? 스포츠 테스트
  // // let postData = {
  // //   username: req.user[0].id,
  // //   game_id: 'live_sport',
  // //   vendor: 'live-inplay',
  // // };

  let postData = {
    username: req.user[0].id,
    game_id: req.body.gameId,
    vendor: req.body.provider,
  };

  const config = {
    method: 'get',
    url: `${process.env.HL_API_ENDPOINT}/game-launch-link`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  await axios(config)
    .then((result) => {
      res.send({ url: result.data.link, isLogin: true });
    })
    .catch((error) => {
      console.log(error.response.data);
      res.send({ url: '', isLogin: true });
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

async function exchangePointToBalance(params) {
  let apiKey;
  let userAssetInfo = await checkUserApiType(params.id);

  if (userAssetInfo.userApiType === 's') {
    apiKey = slotKey;
  } else if (userAssetInfo.userApiType === 'c') {
    apiKey = casinoKey;
  }

  const url = `${process.env.HL_API_ENDPOINT}/user/add-balance`;

  let postData = {
    username: params.id,
    amount: params.reqPoint,
  };

  const config = {
    method: 'post',
    url: url,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  try {
    let result = await axios(config);

    return result.status;
  } catch (error) {
    console.log(error.response.data.message);
    console.log(`${params.타입}처리 실패: ID: ${params.id}`);
  }
}

async function requestAssetWithdraw(params) {
  let apiKey;
  let userAssetInfo = await checkUserApiType(params.id);

  if (userAssetInfo.userApiType === 's') {
    apiKey = slotKey;
  } else if (userAssetInfo.userApiType === 'c') {
    apiKey = casinoKey;
  }

  const url = `${process.env.HL_API_ENDPOINT}/user/sub-balance`;
  const userBalanceInfo = await updateUserBalance(params.id, apiKey);

  if (params.balance !== userBalanceInfo.balance) {
    console.log(
      `회원API 밸런스와 DB 밸런스 불일치: ${params.id} / API_TYPE: ${userApiType === 's' ? '슬롯' : '카지노'} / 회원API: ${userBalanceInfo.balance} / DB: ${
        params.balance
      }`
    );
    return false;
  }

  if (params.reqMoney > userBalanceInfo.balance) {
    params.reqMoney = userBalanceInfo.balance;
  }

  let postData = {
    username: params.id,
    amount: params.reqMoney,
  };

  const config = {
    method: 'post',
    url: url,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: postData,
  };

  try {
    let result = await axios(config);
    //todo 과연 아래의 업데이트 유저 밸런스가 필요할까?
    // await updateUserBalance(params.id);
    console.log(`[${params.타입 || params.type}완료] 대상: ${params.id} / 금액: ${parseInt(params.reqMoney).toLocaleString('ko-KR')}`);

    return result;
  } catch (error) {
    console.log(error.response.data.message);
    console.log(`${params.type}처리 실패: ID: ${params.id}`);
    return error;    
  }
}

async function updateUserBalance(user, apiKey) {
  console.log(`[HL API] 유저 밸런스 업데이트: [${user}]`);
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
    console.log(`[HL API] 유저 밸런스 업데이트 실패: [${params.id}]유저 없음`);
    let userInfo = await getUserInfo(user);
    createUser(userInfo, slotKey);
    createUser(userInfo, casinoKey);
    return params;
  }
}
// #endregion

module.exports = {
  requestGameUrl,
  exchangePointToBalance,
  requestAssetWithdraw,
};
