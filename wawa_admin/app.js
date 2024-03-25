const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' }, methods: ['GET', 'POST'] });
const path = require('path');
const ejs = require('ejs');
const { pool, sqlFormat } = require('./utility/mariadb');
const mybatisMapper = require('./utility/mybatis-mapper');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const userRouter = require('./routes/user');
const cookieParser = require('cookie-parser');
const JSONbig = require('json-bigint');
const betHandler = require('./utility/betApiHandler');
const api = require(`./utility/api/${process.env.API_TYPE}`);
const socket = require('./utility/socket');
const xss = require('xss');
const logger = require('morgan');
const expressLayouts = require('express-ejs-layouts');

// 기본 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

// #region 미들웨어
// 바디파서
app.use(express.json());
app.use(expressLayouts);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// #region 블랙리스트
let blacklistedIps = [];

updateBlacklistedIps();
setInterval(updateBlacklistedIps, 1000 * 60 * 60);

async function updateBlacklistedIps() {
  let conn;
  const sql = mybatisMapper.getStatement('user', 'getBlackList', null, sqlFormat);

  try {
    conn = await pool.getConnection();
    const results = await conn.query(sql);
    blacklistedIps = results.map((row) => row.ip);
  } catch (error) {
    console.error('DB error:', error);
  } finally {
    if (conn) return conn.release();
  }
}

app.use((req, res, next) => {
  if (blacklistedIps.includes(req.ip)) {
    return res.status(403).send('네트워크 오류 발생');
  }
  next();
});
// #endregion

// #region 세션
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PW,
  clearExpired: true,
  checkExpirationInterval: 1000 * 60 * 10,
  expiration: 1000 * 60 * 60,
};

const sessionStore = new MySQLStore(dbConfig);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    name: 'connect.sid.a',
    resave: true,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      maxAge: 1000 * 60 * 60,
    },
    rolling: true,
  })
);

app.use((req, res, next) => {
  // 원래의 touch 함수를 백업
  const originalTouch = req.session.touch;

  req.session.touch = function () {
    // noSessionTouch 플래그가 true인 경우 touch를 수행하지 않음
    if (!req.noSessionTouch) {
      originalTouch.call(this);
    }
  };
  next();
});
app.use(cors());
// #endregion

// #region 보안
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// ddos 공격 예방

// let requestCounter = 0;

// app.use((req, res, next) => {
//   requestCounter += 1;
//   console.log(`Request number: ${requestCounter}`);
//   next();
// });

app.use(
  rateLimit({
    windowMs: 1000 * 60 * 3,
    max: 3000,
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(async (req, res, next) => {
  if (req.user) {
    res.locals.user = req.user[0];
  } else {
    res.locals.user = null;
  }
  next();
});
// #endregion

// #region 로그인 풀림 시
app.use((req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/captcha') {
    return next();
  }
  if (!req.user) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json([]);
    } else {
      return res.render(`login`, { layout: false });
    }
  }
  next();
});
// #endregion

// #region XSS 공격 예방
let ipAttackCounts = {};

function containsSpecialCharacters(input) {
  const specialCharactersXSS = /[<>"'&;:()#]/;
  const specialCharactersSQL = /['";%\-#||&&\/\*]/;

  return specialCharactersXSS.test(input) || specialCharactersSQL.test(input);
}

async function checkXssAttack(req, res, next) {
  if (!req.path.startsWith('/auth')) {
    return next();
  }

  let params = {};
  params.ip = (req.headers['x-forwarded-for'] || '').split(',').shift() || req.socket.remoteAddress;

  const sanitizedBody = {};
  let isSanitized = false;

  for (const key in req.body) {
    if (key === '문의일시' || key === '답변일시') {
      sanitizedBody[key] = req.body[key];
      continue;
    }
    const originalValue = req.body[key];
    const sanitizedValue = xss(originalValue);
    const isDangerous = containsSpecialCharacters(originalValue);

    sanitizedBody[key] = sanitizedValue;

    if (originalValue !== sanitizedValue || isDangerous) {
      params.pattern = originalValue;
      console.log(`[XSS 공격감지] ${key}:`, originalValue);
      isSanitized = true;
    }
  }

  if (isSanitized) {
    if (!ipAttackCounts[params.ip]) {
      ipAttackCounts[params.ip] = 0;
    }

    checkBlackList(params, 'add');
    ipAttackCounts[params.ip]++;

    console.log('공격횟수:', ipAttackCounts[params.ip]);

    if (ipAttackCounts[params.ip] >= 3) {
      await checkBlackList(params, 'confirm');
      console.log(`공격IP: ${req.ip} / 공격횟수 초과로 차단`);
      delete ipAttackCounts[params.ip];
      await updateBlacklistedIps();
      return res.status(403).send({ message: '네트워크 오류 발생' });
    }

    if (req.path === '/user/login') {
      return res.send({ message: '아이디와 비밀번호를 확인하세요', isLogin: false });
    } else if (req.path === '/user/doublecheck') {
      let type;

      switch (req.body.type) {
        case 'id':
          type = '아이디';
          break;
        case 'nickname':
          type = '닉네임';
          break;
        case 'phone':
          type = '전화번호';
          break;
        case 'code':
          type = '가입코드';
          break;
        case 'recommend':
          type = '추천인';
          break;
      }
      console.log(`공격감지로 ${type} 중복확인 차단`);
      return res.send(false);
    } else if (req.path === '/user/join') {
      console.log('공격감지로 회원가입 차단');
      return res.send({ message: '회원가입에 실패했습니다. 다시 시도해주세요', isLogin: false });
    }
  }

  req.body = sanitizedBody;
  next();
}

async function checkBlackList(params, type) {
  let conn = await pool.getConnection();
  let sql;

  if (type == 'add') {
    sql = mybatisMapper.getStatement('user', 'addBlackList', params, sqlFormat);
  } else if (type == 'confirm') {
    sql = mybatisMapper.getStatement('user', 'confirmBlackList', params, sqlFormat);
  }

  try {
    await conn.query(sql);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

app.use(checkXssAttack);
// #endregion

// #endregion

// #region 라우터 등록
app.use('/user', userRouter.router);
app.use('/bank', require('./routes/bank.js'));
app.use('/auth', require('./routes/auth.js'));
app.use('/log', require('./routes/log'));
app.use('/agent', require('./routes/agent.js'));
app.use('/income', require('./routes/income.js'));
app.use('/board', require('./routes/board.js'));
app.use('/game', require('./routes/game.js'));
app.use('/setting', require('./routes/setting.js'));
app.use('/detail', require('./routes/detail.js'));
app.use('/event', require('./routes/event.js'));
// #endregion

// #region 페이지 정보
let PageData = [
  { name: 'current', breadcrumbData: { name: 'Ui Kits', subName: 'accordion' } },
  { name: 'index', breadcrumbData: { name: '대시보드', subName: '홈' } },
  { name: 'user-info', breadcrumbData: { name: '회원정보', subName: '회원관리' } },
  { name: 'agent-info', breadcrumbData: { name: '파트너정보', subName: '회원관리' } },
  { name: 'user-block', breadcrumbData: { name: '차단회원', subName: '회원관리' } },
  { name: 'online', breadcrumbData: { name: '현재접속', subName: '회원관리' } },
  { name: 'user-connect', breadcrumbData: { name: '접속내역', subName: '회원관리' } },
  { name: 'user-confirm', breadcrumbData: { name: '회원승인', subName: '회원관리' } },
  { name: 'bank-deposit', breadcrumbData: { name: '입금내역', subName: '머니' } },
  { name: 'bank-withdraw', breadcrumbData: { name: '출금내역', subName: '머니' } },
  { name: 'bank-give', breadcrumbData: { name: '지급내역', subName: '머니' } },
  { name: 'bank-take', breadcrumbData: { name: '회수내역', subName: '머니' } },
  { name: 'board', breadcrumbData: { name: '게시판', subName: '통합 게시판' } },
  { name: 'log-balance', breadcrumbData: { name: '보유금 변동내역', subName: '각종 내역' } },
  { name: 'log-point', breadcrumbData: { name: '포인트 변동내역', subName: '각종 내역' } },
  { name: 'betting-detail-casino', breadcrumbData: { name: '카지노베팅내역', subName: '각종 내역' } },
  { name: 'betting-detail-slot', breadcrumbData: { name: '슬롯베팅내역', subName: '각종 내역' } },
  { name: 'betting-summary-casino', breadcrumbData: { name: '카지노베팅요약', subName: '각종 내역' } },
  { name: 'betting-summary-slot', breadcrumbData: { name: '슬롯베팅요약', subName: '각종 내역' } },
  { name: 'income-hq', breadcrumbData: { name: '본사정산', subName: '정산' } },
  { name: 'income-agent-live', breadcrumbData: { name: '실시간정산', subName: '정산' } },
  { name: 'income-agent-daily', breadcrumbData: { name: '일별정산', subName: '정산' } },
  { name: 'income-agent-betwin', breadcrumbData: { name: '파트너정산 (실시간 및 날짜별)', subName: '정산' } },
  { name: 'setting-slot', breadcrumbData: { name: '슬롯설정', subName: '설정' } },
  { name: 'setting-system', breadcrumbData: { name: '시스템설정', subName: '설정' } },
];
// #endregion

// #region 라우트
//? 테이블 뷰
let sport = process.env.SPORT_VIEW;
let lotto = process.env.EVENT_LOTTERY;
let slotKey = process.env.HL_API_KEY_SLOT;
let casinoKey = process.env.HL_API_KEY_CASINO;

app.get(`/`, async function (req, res) {
  if (req.user) {
    let summary = await getData(res, 'getAgentSummary');
    summary = JSON.parse(summary);
    summary = getAgentSummary(summary);
    res.render(`index`, { summary: summary, user: req.user[0], sport: sport, lotto: lotto, breadcrumbName: '대시보드', breadcrumbPath: '홈' });
  } else {
    res.render(`login`, { layout: false });
  }
});

function getAgentSummary(summary) {
  const types = [0, 1, 2, 3, 4];
  for (const type of types) {
    if (!summary.some((item) => item.type == type)) {
      summary.push({ type: type, total_count: 0, total_balance: 0, total_point: 0 });
    }
  }
  summary.sort((a, b) => a.type - b.type);
  return summary;
}

app.get('/:menu', async (req, res) => {
  if (req.params.menu === 'favicon.ico') {
    return res.status(204).send(); // 또는 적절한 처리
  }

  if (req.user) {
    const pageData = PageData.find((p) => p.name === req.params.menu);
    if (!pageData) {
      return res.status(404).send('Page not found');
    }

    const { breadcrumbData } = pageData;
    const breadcrumbName = breadcrumbData.name;
    const breadcrumbPath = breadcrumbData.subName;

    let summary = await getData(res, 'getAgentSummary');
    summary = JSON.parse(summary);
    summary = getAgentSummary(summary);

    res.render(req.params.menu, {
      user: req.user[0],
      summary: summary,
      sport: sport,
      lotto: lotto,
      breadcrumbName: breadcrumbName,
      breadcrumbPath: breadcrumbPath,
    });
  } else {
    res.redirect('/');
  }
});

//? 대시보드
app.post('/adminonline', async (req, res) => {
  if (onlineUsers.length != 0 && req.user) {
    params = { ids: onlineUsers, node_id: req.user[0].node_id };
    let result = await getData(res, 'adminOnlineUsersWawa', params);
    // let result = await getData(res, 'adminOnlineUsers', params);
    res.send(result);
  } else {
    res.send([]);
  }
});

app.post('/agentonline', async (req, res) => {
  if (req.user && onlineUsers.length != 0) {
    params = { ids: onlineUsers, node_id: req.user[0].node_id, agentType: req.user[0].type };
    let result = await getData(res, 'agentOnlineUsers', params);
    res.send(result);
  } else {
    res.send([]);
  }
});

app.post('/navbar', async (req, res) => {
  if (req.user) {
    getNavbarData(req, res, onlineUsers);
  } else {
    res.send('로그인이 필요합니다.');
  }
});

app.post('/adminbalance', async (req, res) => {
  if (req.user && req.user[0].type === 9) {
    res.send({ balance: req.user[0].balance });
  } else {
    res.send('로그인이 필요합니다.');
  }
});

const getQueryResult = async (conn, queryData) => {
  let result = await conn.query(queryData);
  result = JSONbig.stringify(result[0]);
  return JSON.parse(result);
};

async function getNavbarData(req, res, onlineUsers) {
  const userType = req.user[0].type;
  const isAdmin = userType === 9;
  const isAgent = userType !== 4;
  let conn = await pool.getConnection();

  try {
    let dashboardQueries = {
      giveTakeData: isAdmin ? 'getAdminGiveTakeData' : isAgent ? 'getAgentGiveTakeData' : null,
      summaryData: isAdmin ? 'getAdminSummaryData' : isAgent ? 'getAgentSummaryData' : null,
      navData: isAdmin ? 'getAdminNavData' : isAgent ? 'getAgentNavData' : null,
      todayJoinCount: 'countTodayJoinUser',
    };

    let responseData = {};
    for (let key in dashboardQueries) {
      if (dashboardQueries[key]) {
        const queryData = mybatisMapper.getStatement('dashboard', dashboardQueries[key], isAdmin ? {} : req.user[0], sqlFormat);
        responseData[key] = await getQueryResult(conn, queryData);
      }
    }
    responseData.countOnlineUsers = (onlineUsers || []).length;
    res.send(responseData);
  } catch (e) {
    console.log(e);
  } finally {
    if (conn) conn.release();
  }
}

app.post('/tempclear', async (req, res) => {
  clearTempBettingInfo(res, req.body);
});

app.post('/bankchart', async (req, res) => {
  let result = await getData(res, 'getBankChart');
  res.send(result);
});

//? 소켓
app.post('/clientId', (req, res) => {
  if (req.user) {
    res.send(req.user[0]);
  } else {
    res.send('로그인이 필요합니다.');
  }
});

app.post('/notification', (req, res) => {
  getNotificationCount(req, res);
});

app.post('/offalram', (req, res) => {
  offAlram();
  res.send('알림끄기');
});

app.post('/bet'),
  (req, res) => {
    res.send('ok');
  };

app.post('/envinfo', (req, res) => {
  let envInfo = {
    lotto: process.env.EVENT_LOTTERY,
  };
  res.send(envInfo);
});
// #endregion

// #region 소켓서버
let onlineUsers = [];
const disconnectTimeouts = {};
const clients = {};

io.on('connection', async (socket) => {
  const clientId = socket.handshake.query.clientId;
  const clientType = socket.handshake.query.clientType;

  if (clientType == 4) {
    if (disconnectTimeouts[clientId]) {
      clearTimeout(disconnectTimeouts[clientId]);
      delete disconnectTimeouts[clientId];
    }

    for (const [id, client] of Object.entries(clients)) {
      if ((client.clientId === clientId && id !== socket.id) || clientId == undefined) {
        // 기존 소켓 연결 해제
        const existingSocket = io.sockets.sockets.get(id);
        if (existingSocket) {
          existingSocket.disconnect(true);
        }
        // clients 객체에서 제거
        delete clients[id];
      }
    }
  }

  // 새로운 클라이언트 정보 등록
  clients[socket.id] = { clientId, clientType, lastHeartbeat: Date.now() };

  // 클라이언트 목록 출력
  Object.values(clients).forEach((client, index) => {
    // console.log(`접속자 ${index}번:`);
    // console.log(client);
  });

  // userId로 룸에 참가하기
  socket.join(clientId);
  // userType으로 룸에 참가하기
  socket.join(clientType);

  socket.on('error', function (error) {
    console.error('Error:', error);
  });

  socket.on('to_admin', (data) => {
    if (data.type !== 'updateOnlineUsers') {
      updateNotification(data.type);
    }
    io.to('admin').emit(data.type, data.userId);
  });

  socket.on('to_user', (data) => {
    if (data.type !== 'sendMessage') {
      updateNotification(data.type);
      io.to('admin').emit('update_icon', data.type);
    }
    io.to(data.id).emit('to_user', data);
  });

  socket.on('checkIcon', (data) => {
    updateNotification(data);
  });

  socket.on('forceDisconnect', (data) => {
    console.log('강제종료:', data);
    // io.to(data).emit('forceDisconnect');
  });

  // socket.on('error', (data) => {
  //   console.log('오류메시지 수신:', data);
  //   io.emit('error', data);
  // });

  socket.on('heartbeat', () => {
    if (clients[socket.id]) {
      clients[socket.id].lastHeartbeat = Date.now();
    }
  });

  socket.on('disconnect', async () => {
    const sessionOutInterval = 3;
    const client = clients[socket.id];

    if (client && client.clientType === '4') {
      updateUserBalances();
      if (disconnectTimeouts[client.clientId]) {
        console.log('연결해제 타이머있었음');
        clearTimeout(disconnectTimeouts[client.clientId]);
        delete disconnectTimeouts[client.clientId];
      }

      disconnectTimeouts[client.clientId] = setTimeout(async () => {
        let checkSession = await checkDisconnectedUser(client.clientId);
        if (checkSession == 1) {
          deleteDisconectedUser(client.clientId);
          let loginInfo = await getLoginInfo(client.clientId);
          loginInfo.time = userRouter.getCurrentTime();
          loginInfo.type = '세션아웃';
          loginInfo.domain = loginInfo.connect_domain;
          insertConnectInfo(loginInfo);
          console.log(`세션아웃: [ ID: ${client.clientId} ]`);
        }

        delete clients[socket.id];
        delete disconnectTimeouts[client.clientId];
      }, 1000 * 60 * sessionOutInterval);
    }
  });
});

const connectedSockets = io.sockets.sockets;
connectedSockets.forEach((socket, socketId) => {
  console.log(`Socket connected with id: ${socketId}`);
});
// #endregion

// #region 소켓관련 함수
async function getNotificationCount(req, res) {
  let conn = await pool.getConnection();

  let sql = mybatisMapper.getStatement('socket', 'checkNotification', {}, sqlFormat);
  let offAlram = mybatisMapper.getStatement('socket', 'offAlram', {}, sqlFormat);

  try {
    result = await conn.query(sql);
    if (result[0].deposit == 0 && result[0].withdraw == 0 && result[0].join == 0 && result[0].question == 0) {
      await conn.query(offAlram);
    }
    if (req.user && req.user[0]) {
      res.send({ result: result, user: req.user[0] });
    } else {
      res.send({ result: result, user: null });
    }
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function updateNotification(type) {
  let conn = await pool.getConnection();

  if (type == 'requestUserDeposit' || type == 'requestAgentDeposit') {
    type = 'requestDeposit';
  } else if (type == 'requestUserWithdraw' || type == 'requestAgentWithdraw') {
    type = 'requestWithdraw';
  } else if (type == 'confirmDepositAttendant') {
    type = 'confirmDeposit';
  }

  let sql = mybatisMapper.getStatement('socket', type, {}, sqlFormat);

  try {
    result = await conn.query(sql);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function checkDisconnectedUser(clientId) {
  let conn = await pool.getConnection();
  let chaeckDisconectedUser = mybatisMapper.getStatement('socket', 'checkDisconnectedUser', { userId: clientId }, sqlFormat);

  try {
    let result = await conn.query(chaeckDisconectedUser);
    return result.length;
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}

async function deleteDisconectedUser(clientId) {
  let conn = await pool.getConnection();
  let deleteDisconectedUser = mybatisMapper.getStatement('socket', 'deleteDisconnectedUser', { userId: clientId }, sqlFormat);

  try {
    await conn.query(deleteDisconectedUser);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function getLoginInfo(clientId) {
  let conn = await pool.getConnection();
  let getLoginInfo = mybatisMapper.getStatement('socket', 'getLoginInfo', { userId: clientId }, sqlFormat);

  try {
    let result = await conn.query(getLoginInfo);
    return result[0];
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}

async function insertConnectInfo(connectParams) {
  let conn = await pool.getConnection();

  try {
    let insertConnectInfo = mybatisMapper.getStatement('auth', 'insertConnectInfo', connectParams, sqlFormat);
    await conn.query(insertConnectInfo);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function offAlram() {
  let conn = await pool.getConnection();
  let sql = mybatisMapper.getStatement('socket', 'offAlram', {}, sqlFormat);

  try {
    await conn.query(sql);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}
// #endregion

// #region 데이터베이스
let betUsers = [];

async function getData(res, type, params = {}) {
  let conn = await pool.getConnection();

  let sql = mybatisMapper.getStatement('dashboard', type, params, sqlFormat);

  try {
    let result = await conn.query(sql);
    result = JSONbig.stringify(result);
    return result;
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}

async function updateCombineAssets() {
  let allUsers;
  let conn = await pool.getConnection();
  let getAllUsers = mybatisMapper.getStatement('log', 'getAllUsers', {}, sqlFormat);
  try {
    allUsers = await conn.query(getAllUsers);
    for (const el of allUsers) {
      let getParams = el;
      let getCombineAssets = mybatisMapper.getStatement('log', 'getCombineAssets', getParams, sqlFormat);
      let combineAssets = await conn.query(getCombineAssets);

      if (combineAssets.length === 0 || !combineAssets[0][0]) continue;

      let updateParams = combineAssets[0][0];
      let updateCombineAssets = mybatisMapper.getStatement('log', 'updateCombineAssets', updateParams, sqlFormat);
      await conn.query(updateCombineAssets);
    }
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function clearTempBettingInfo(res, params) {
  let conn = await pool.getConnection();
  let sql = mybatisMapper.getStatement('dashboard', 'clearTempBettingInfo', params, sqlFormat);
  try {
    await conn.query(sql);
    res.send('임시내역 삭제 완료');
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

async function filterUsers(userIds) {
  let conn = await pool.getConnection();
  let getUsersWithType4 = mybatisMapper.getStatement('user', 'getUsersWithType4', { userIds }, sqlFormat);

  try {
    let result = await conn.query(getUsersWithType4);
    return result.map((row) => row.id);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}

async function getLoggedId() {
  let conn = await pool.getConnection();
  let getLoggedId = mybatisMapper.getStatement('socket', 'getLoggedId', {}, sqlFormat);

  try {
    let result = await conn.query(getLoggedId);
    return result.map((row) => row.id);
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) conn.release();
  }
}
// #endregion

// #region 유저밸런스 업데이트
async function updateUserBalanceInDB(params) {
  let conn = await pool.getConnection();
  let checkType = mybatisMapper.getStatement('log', 'checkUserType', params, sqlFormat);
  let updateBalance = mybatisMapper.getStatement('log', 'updateUserBalance', params, sqlFormat);
  try {
    let result = await conn.query(checkType);
    if (result[0].type == 4) {
      await conn.query(updateBalance);
    }
  } catch (e) {
    console.log(e);
    return done(e);
  } finally {
    if (conn) return conn.release();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updateUserBalances = async () => {
  let loggedIds = await getLoggedId();
  onlineUsers = [...new Set([...loggedIds])];

  if (onlineUsers.length > 0) {
    onlineUsers = await filterUsers(onlineUsers);
    await Promise.all(
      onlineUsers.map(async (user) => {
        try {
          const [slotResult, casinoResult] = await Promise.all([api.updateUserBalance(user, slotKey), api.updateUserBalance(user, casinoKey)]);

          let slotBalance = slotResult.balance;
          let casinoBalance = casinoResult.balance;

          const params = { id: user, slot_balance: slotBalance, casino_balance: casinoBalance };
          updateUserBalanceInDB(params);
          await delay(500);
        } catch (error) {
          console.error('Error updating user balance for user:', user.id, error);
          // 적절한 오류 처리 로직
        }
      })
    );
    if (onlineUsers.length != 0) {
      updateCombineAssets();
    }
  }
  api.updateAdminBalance('slot', slotKey);
  await delay(500);
  api.updateAdminBalance('casino', casinoKey);
  socket.emit('to_admin', { id: '', type: 'updateOnlineUsers' });
};

async function updateAllUserBalance() {
  const slotResult = await api.updateAllUserBalance(slotKey);
  const casinoResult = await api.updateAllUserBalance(casinoKey);
  await mergeBalance(slotResult, casinoResult);
}

async function mergeBalance(slotResult, casinoResult) {
  const userBalances = slotResult.map((slotUser) => {
    const casinoUser = casinoResult.find((casinoUser) => casinoUser.username === slotUser.username);
    return {
      username: slotUser.username,
      slot_balance: slotUser.balance,
      casino_balance: casinoUser ? casinoUser.balance : 0,
    };
  });
  const userAssetParams = await makeUserAssetParams(userBalances);
  await updateUserAssetInfo(userAssetParams);
}

async function getUserId(username) {
  let conn = await pool.getConnection();
  let sql = mybatisMapper.getStatement('user', 'getUserId', { id: username }, sqlFormat);

  try {
    const result = await conn.query(sql);
    return result[0];
  } catch (error) {
    console.error('유저 ID 조회 중 오류 발생:', error);
  } finally {
    if (conn) conn.release();
  }
}

async function makeUserAssetParams(userBalances) {
  const userAssetParams = [];

  for (const { username, slot_balance, casino_balance } of userBalances) {
    try {
      const userId = await getUserId(username);
      if (!userId || userId.user_id === undefined) {
        continue;
      }
      const user_id = userId.user_id;
      userAssetParams.push({
        user_id,
        username,
        slot_balance,
        casino_balance,
      });
    } catch (error) {
      console.error('오류발생:', username, error);
    }
  }
  return userAssetParams;
}

async function updateUserAssetInfo(userAssetParams) {
  let conn = await pool.getConnection();
  // console.time('업데이트 유저에셋');
  for (userAsset of userAssetParams) {
    try {
      let sql = mybatisMapper.getStatement('user', 'updateUserAssetInfo', userAsset, sqlFormat);
      await conn.query(sql);
    } catch (error) {
      console.error('유저 자산 정보 업데이트 중 오류 발생:', error);
    } finally {
      if (conn) conn.release();
    }
  }
  // console.timeEnd('업데이트 유저에셋');
}

//todo 튜닝가치 있어보임
// async function updateUserAssetInfo(userAssetParams) {
//   let conn;
//   try {
//     conn = await pool.getConnection();

//     // console.time('업데이트 유저에셋');
//     let sql = mybatisMapper.getStatement('user', 'upsertUserAssetInfoTune', { userAssetParams: userAssetParams }, sqlFormat);
//     let result = await conn.query(sql);
//     // console.timeEnd('업데이트 유저에셋');
//   } catch (error) {
//     if (conn) await conn.rollback(); // 오류 발생 시 트랜잭션 롤백
//     console.error('Batch update of user asset info failed:', error);
//   } finally {
//     if (conn) conn.release(); // 데이터베이스 연결 해제
//   }
// }

// #endregion

const logOnlineUsersAndRequestDetails = async () => {
  const slotUsers = (await api.requestDetailLog(slotKey, 'slot')) || [];
  await betHandler.requestSummaryLog();

  setTimeout(async () => {
    const casinoUsers = (await api.requestDetailLog(casinoKey, 'casino')) || [];
    let betUsers = slotUsers;
    casinoUsers.forEach((casinoUser) => {
      const isDuplicate = betUsers.some((slotUser) => slotUser.id === casinoUser.id);
      if (!isDuplicate) {
        betUsers.push(casinoUser);
      }
    });

    await betHandler.requestSummaryLog();

    if (onlineUsers.length != 0) {
      console.log('접속 유저목록: ', onlineUsers);
    } else {
      console.log('[ 접속한 유저가 없습니다 ]');
    }
  }, 1000 * 30);
};

http.listen(process.env.ADMIN_PORT, '0.0.0.0', () => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const timeUntilMidnight = midnight - now - 1000;

  setTimeout(updateUserBalances, timeUntilMidnight);
  setInterval(updateUserBalances, 1000 * 5);
  setInterval(updateAllUserBalance, 1000 * 20);
  setInterval(logOnlineUsersAndRequestDetails, 1000 * 90);

  console.log(`Example app listening on port ${process.env.ADMIN_PORT}`);
});
