let startDate = moment().format('YYYY-MM-DD');
let endDate = moment().format('YYYY-MM-DD');
let startDateTime = moment().format('YYYY-MM-DD 00:00');
let endDateTime = moment().format('YYYY-MM-DD 23:59');

const commonOptions = {
  minYear: moment().year() - 1,
  maxYear: moment().year() + 2,
  ranges: {
    오늘: [moment().startOf('day'), moment().endOf('day')],
    어제: [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
    '7일 전': [moment().subtract(6, 'days').startOf('day'), moment().endOf('day')],
    '15일 전': [moment().subtract(14, 'days').startOf('day'), moment().endOf('day')],
    '30일 전': [moment().subtract(29, 'days').startOf('day'), moment().endOf('day')],
    '이번 달': [moment().startOf('month'), moment().endOf('month')],
    '저번 달': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
  },
  autoApply: true,
  showDropdowns: true,
  alwaysShowCalendars: true,
  locale: {
    format: 'YYYY-MM-DD',
    separator: ' ~ ',
    applyLabel: '확인',
    cancelLabel: '취소',
    fromLabel: 'From',
    toLabel: 'To',
    daysOfWeek: ['일', '월', '화', '수', '목', '금', '토'],
    monthNames: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
  },
};

let dateFormatCallback = function (start, end, label) {
  startDate = start.format('YYYY-MM-DD');
  endDate = end.format('YYYY-MM-DD');
  $('table.dataTable').DataTable().ajax.reload();
};

let datetimeFormatCallback = function (start, end, label) {
  startDateTime = start.format('YYYY-MM-DD HH:mm');
  endDateTime = end.format('YYYY-MM-DD HH:mm');
  $('table.dataTable').DataTable().ajax.reload();
};

let detailCallback = function (start, end, label) {
  startDateTime = start.format('YYYY-MM-DD HH:mm');
  endDateTime = end.format('YYYY-MM-DD HH:mm');
  $('table.detailUserTable').DataTable().ajax.reload();
};

$(function () {
  $('#dateSelector').daterangepicker(commonOptions, dateFormatCallback);
});

$(function () {
  $('#dateTimeSelector').daterangepicker(
    {
      ...commonOptions,
      timePicker: true,
      timePicker24Hour: true,
    },
    datetimeFormatCallback
  );
});

$(function () {
  $('.detailDateSelector').daterangepicker(
    {
      ...commonOptions,
      timePicker: true,
      timePicker24Hour: true,
    },
    detailCallback
  );
});

$('#providerModal').on('shown.bs.modal', function () {
  $('#reserveDateSelector').daterangepicker(
    $.extend({}, commonOptions, {
      timePicker: true,
      locale: $.extend({}, commonOptions.locale, {
        format: 'YY-MM-DD hh:mm A',
      }),
    }),
    dateFormatCallback
  );
});

$('#dateSeletor, #dataTimeSelector, #reserveDateSelector, .detailDateSelector ').daterangepicker('setDate', 'today');
