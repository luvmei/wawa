let korean = {
  decimal: '',
  emptyTable: '데이터가 없습니다.',
  info: '_START_ - _END_ (총 _TOTAL_)',
  infoEmpty: ' ',
  infoFiltered: '(전체 _MAX_ 명 중 검색결과)',
  infoPostFix: '',
  thousands: ',',
  lengthMenu: '_MENU_ 개씩 보기',
  loadingRecords: '로딩중...',
  processing: '처리중...',
  search: '검색 : ',
  zeroRecords: '검색된 데이터가 없습니다.',
  paginate: {
    first: '첫 페이지',
    last: '마지막 페이지',
    next: '다음',
    previous: '이전',
  },
  aria: {
    sortAscending: ' :  오름차순 정렬',
    sortDescending: ' :  내림차순 정렬',
  },
};

function initPopover() {
  setTimeout(() => {
    const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');

    const popoverList = [...popoverTriggerList].map((popoverTriggerEl) => new bootstrap.Popover(popoverTriggerEl), {
      container: 'body',
    });

    const tooltipList = [...tooltipTriggerList].map((tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl));
  }, 100);
}

let exchangePointLog = $('#exchangePointLog').DataTable({
  language: korean,
  scrollY: '22vh',
  scrollCollapse: true,
  ajax: {
    url: '/log/exchange',
    method: 'POST',
    dataSrc: '',
  },
  dom: 'rt',
  columns: [
    { data: '전환일시', className: 'desktop' },
    { data: '이전보유금', className: 'desktop' },
    { data: '전환포인트', className: 'desktop' },
    { data: '적용보유금', className: 'desktop' },
  ],
  order: [[0, 'desc']],
  pageLength: 100,
  lengthMenu: [100, 200, 300],
  columnDefs: [
    {
      target: [0, 1, 2, 3],
      orderable: false,
      className: 'dt-head-center dt-body-center',
    },
    {
      target: [1, 3],
      className: 'fw-semibold',
      render: $.fn.dataTable.render.number(','),
    },
    {
      target: 0,
      render: function (data, type, row) {
        var parts = data.split(' ');
        var date = parts[0];
        var number = parts[1];
        return `${date}<br>${number}`;
      },
    },
    {
      target: 2,
      render: function (data) {
        return `<span class='txt-primary fw-bold'>${data.toLocaleString('ko-KR')}</span>`;
      },
    },
  ],
});
