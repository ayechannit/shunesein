const calculateSellingPrice = ({ costPrice, markupType, markupValue }) => {
  const parsedCostPrice = Number(costPrice);
  const parsedMarkupValue = Number(markupValue);

  if (Number.isNaN(parsedCostPrice)) {
    return null;
  }

  if (markupType === 'percentage') {
    if (Number.isNaN(parsedMarkupValue)) {
      return parsedCostPrice;
    }

    return parsedCostPrice - (parsedCostPrice * parsedMarkupValue / 100);
  }

  if (markupType === 'fixed') {
    if (Number.isNaN(parsedMarkupValue)) {
      return parsedCostPrice;
    }

    return parsedCostPrice + parsedMarkupValue;
  }

  return parsedCostPrice;
};

module.exports = {
  calculateSellingPrice,
};
