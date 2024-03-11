let login_form = document.querySelector('#login-data');

login_form.addEventListener('submit', function (e) {
  e.preventDefault();

  let login_data = $('#login-data').serialize();

  $.ajax({
    method: 'POST',
    url: '/auth/login',
    data: login_data,
  })
    .done(function (result) {
      if (result.isLogin) {
        location.href = '/';
        // location.reload();
      } else {
        loadCaptcha();
        document.querySelector('#login-data').reset();
        document.querySelector('#login-alert').classList.remove('d-none');
      }
      // checkLogin(result);
    })
    .fail(function (err) {
      console.log(err);
    });
});

// #region 캡챠
const captchaImg = document.querySelector('.captcha-img');
const captchaInput = document.querySelector('.captcha-input');

window.loadCaptcha = async function () {
  try {
    const response = await fetch('/auth/captcha?' + new URLSearchParams({ timestamp: Date.now() }));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    captchaImg.src = url;
  } catch (error) {
    console.error('Error fetching captcha:', error);
  }
};

captchaImg.addEventListener('click', window.loadCaptcha);
// #endregion
