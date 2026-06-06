function paginate(query, page = 1, perPage = 20) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, parseInt(perPage) || 20));
  const offset = (pageNum - 1) * perPageNum;

  return {
    page: pageNum,
    perPage: perPageNum,
    offset,
  };
}

function formatPaginatedResponse(data, total, page, perPage) {
  const totalPages = Math.ceil(total / perPage);
  
  return {
    success: true,
    data,
    meta: {
      page,
      perPage,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = { paginate, formatPaginatedResponse };
