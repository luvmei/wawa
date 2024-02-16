let notificationCount;
let alram;
let clientId;
let clientType;
let clientNode;
let treeInfo;
let socket;

function getClientId() {
  $.ajax({
    method: 'POST',
    url: '/clientId',
    async: false,
  })
    .done(function (result) {
      clientId = result.id;
      clientType = result.type;
      if (result.type != 9) {
        clientNode = result.node_id;
      }
    })
    .fail(function (err) {
      console.log('전송오류');
      console.log(err);
    });
}
getClientId();

if (clientType == 9) {
  countNotification();

  setInterval(() => {
    countNotification();
  }, 1000 * 5);
}

if (clientId) {
  socket = io({ query: { clientId: clientId, clientType: clientType } });

  //? 소켓 응답
  socket.on('updateOnlineUsers', (data) => {
    // const dataTableModal = document.querySelector('.dtr-modal');
    // if (!dataTableModal) {
    //   console.log('모달없다 - 업데이트');

    //   $('#onlineUsers, #onlineUsersAgent,#dashboardBank,#dashboardAgentBank,#giveTake,#qna,#notice').DataTable().ajax.reload(null, false);
    // } else {
    //   console.log('모달있다 - 업데이트안함');
    // }
  });

  socket.on('requestUserDeposit', (data) => {
    countNotification();
    let audio = new Audio('/assets/mp3/userDeposit.mp3');
    audio.play();
    // console.log(data + ' 회원의 입금이 신청되었습니다');

    $('#deposit, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw').DataTable().ajax.reload(null, false);
  });

  socket.on('requestAgentDeposit', (data) => {
    countNotification();
    let audio = new Audio('/assets/mp3/agentDeposit.mp3');
    audio.play();
    // console.log(data + ' 에이전트의 입금이 신청되었습니다');

    $('#deposit, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw').DataTable().ajax.reload(null, false);
  });

  socket.on('requestUserWithdraw', (data) => {
    let audio = new Audio('/assets/mp3/userWithdraw.mp3');
    audio.play();
    countNotification();
    // console.log(data + ' 회원의 출금이 신청되었습니다');

    $('#withdraw, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw').DataTable().ajax.reload(null, false);
  });

  socket.on('requestAgentWithdraw', (data) => {
    let audio = new Audio('/assets/mp3/agentWithdraw.mp3');
    audio.play();
    countNotification();
    // console.log(data + ' 에이전트의 출금이 신청되었습니다');

    $('#withdraw, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw').DataTable().ajax.reload(null, false);
  });

  socket.on('to_user', (data) => {
    if (data == 'confirmDeposit') {
      getNavModalData();
      let audio = new Audio('/assets/mp3/deposit_confirm.mp3');
      audio.play();
      document.querySelector('#confirm-text').innerHTML = `<div class='fs-4 fw-bold my-2'>신청하신 입금이 처리되었습니다</div>`;
      $('#agentConfirmModal').modal('show');
      $('#deposit, #depositWithdraw, #dashboardBank,#dashboardWait, #dashboardAgentBank').DataTable().ajax.reload(null, false);
      console.log(data + ' 에이전트의 입금이 처리되었습니다');
    } else if (data == 'confirmWithdraw') {
      let audio = new Audio('/assets/mp3/withdraw_confirm.mp3');
      audio.play();
      document.querySelector('#confirm-text').innerHTML = `<div class='fs-4 fw-bold my-2'>신청하신 출금이 처리되었습니다</div>`;
      $('#agentConfirmModal').modal('show');
      $('#withdraw, #depositWithdraw, #dashboardBank,#dashboardWait, #dashboardAgentBank').DataTable().ajax.reload(null, false);
      console.log(data + ' 에이전트의 출금이 처리되었습니다');

      $('#deposit, #depositWithdraw').DataTable().ajax.reload(null, false);
    } else if (data == 'answerQuestion') {
      let audio = new Audio('/assets/mp3/answer.mp3');
      audio.play();
      $('#agentQna').DataTable().ajax.reload(null, false);
      agentCheckNoti();
    }
  });

  socket.on('requestQuestion', (data) => {
    let audio = new Audio('/assets/mp3/question.mp3');
    audio.play();
    countNotification();
    console.log('회원의 문의가 등록되었습니다');

    $('#qna').DataTable().ajax.reload(null, false);
  });

  socket.on('update_icon', (data) => {
    let type;
    countNotification();
    switch (data) {
      case 'confirmDeposit':
        type = '#deposit, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw';
        break;
      case 'confirmDepositAttendant':
        type = '#deposit, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw';
        break;
      case 'confirmWithdraw':
        type = '#withdraw, #dashboardBank, #dashboardAgentBank, #dashboardWait, #depositWithdraw';
        break;
      case 'answerQuestion':
        type = '#qna';
        break;
      case 'confirmJoin':
        type = '#userJoinConfirm';
        break;
    }
    $(`${type}`).DataTable().ajax.reload(null, false);
  });

  socket.on('requestJoin', (data) => {
    let audio = new Audio('/assets/mp3/join.mp3');
    audio.play();
    countNotification();
    console.log(data + ' 회원의 가입승인 요청이 있습니다');
    $('#userJoinConfirm').DataTable().ajax.reload(null, false);
  });

  socket.on('error', (data) => {
    document.querySelector('#notice-text').innerHTML = `${data}`;
    $('#confirmCancel').modal('hide');
    $('#alertModal').modal('show');
    $('table').not('#incomeDetail').DataTable().ajax.reload(null, false);
  });

  // 하트비트 관련 코드 현재 사용안함
  // setInterval(() => {
  //   socket.emit('heartbeat', { timestamp: Date.now() });
  // }, 10000); // 예를 들어 10초마다 하트비트를 보냅니다.
}

function countNotification() {
  $.ajax({
    method: 'POST',
    url: '/notification',
  })
    .done(function (result) {
      if (result.user) {
        if (result.user.type == 9) {
          notificationCount = result.result[0];
          const depositIcon = document.getElementById('depositIcon');
          const withdrawIcon = document.getElementById('withdrawIcon');
          const approvalIcon = document.getElementById('approvalIcon');
          const messageIcon = document.getElementById('messageIcon');
          const alramIcon = document.getElementById('alramIcon');

          if (result.result[0].deposit > 0) {
            updateIcon(depositIcon, 'btn-light', 'btn-secondary', 'tada 1.5s ease infinite');
          } else {
            result.result[0].deposit = 0;
            updateIcon(depositIcon, 'btn-secondary', 'btn-light', null);
          }

          if (result.result[0].withdraw > 0) {
            updateIcon(withdrawIcon, 'btn-light', 'btn-secondary', 'tada 1.5s ease infinite');
          } else {
            result.result[0].withdraw = 0;
            updateIcon(withdrawIcon, 'btn-secondary', 'btn-light', null);
          }

          if (result.result[0].join > 0) {
            updateIcon(approvalIcon, 'btn-light', 'btn-secondary', 'tada 1.5s ease infinite');
          } else {
            result.result[0].join = 0;
            updateIcon(approvalIcon, 'btn-secondary', 'btn-light', null);
          }

          if (result.result[0].question > 0) {
            updateIcon(messageIcon, 'btn-light', 'btn-secondary', 'tada 1.5s ease infinite');
          } else {
            result.result[0].question = 0;
            updateIcon(messageIcon, 'btn-secondary', 'btn-light', null);
          }

          if (result.result[0].alram == 1) {
            updateIcon(alramIcon, 'text-secondary', 'txt-secondary', 'tada 1.5s ease infinite');
            playAlram();
          } else {
            updateIcon(alramIcon, 'txt-secondary', 'text-secondary', null);
          }

          function updateIcon(element, removeClass, addClass, animationStyle) {
            element.classList.remove(removeClass);
            element.classList.add(addClass);
            element.style.animation = animationStyle;
          }
        }
      } else {
        window.location.href = '/';
      }
    })
    .fail(function (err) {
      console.log('전송오류');
      console.log(err);
    });
}

function playAlram() {
  let bell = new Audio('/assets/mp3/alram.mp3');
  bell.play();
}

if (document.querySelector('#alramIcon')) {
  document.querySelector('#alramIcon').addEventListener('click', () => {
    offAlram();
  });
}

function offAlram() {
  $.ajax({
    method: 'POST',
    url: '/offalram',
  })
    .done(function (result) {
      countNotification();
      // document.querySelector('#alramIcon').innerHTML = `<i class="fa-solid fa-volume-xmark fa-2x">`;
      // document.querySelector('#alramIcon').classList.remove('text-white');
    })
    .fail(function (err) {
      console.log('전송오류');
      console.log(err);
    });
}
