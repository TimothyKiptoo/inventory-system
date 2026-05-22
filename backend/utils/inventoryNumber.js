function slugPart(value) {
  return String(value || "NA")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "NA";
}

function initialsPart(value) {
  const tokens = String(value || "")
    .trim()
    .toUpperCase()
    .match(/[A-Z0-9]+/g);

  if (!tokens || !tokens.length) {
    return "NA";
  }

  if (tokens.length >= 3) {
    return tokens
      .slice(0, 3)
      .map((token) => token[0])
      .join("");
  }

  return tokens.join("").slice(0, 3) || "NA";
}

function compactSegment(value) {
  return slugPart(value).replace(/-/g, "").slice(0, 3) || "NA";
}

function buildInventoryPrefix({
  companyName,
  departmentCode,
  departmentName,
  categoryCode,
  categoryName,
  subcategoryCode,
  subcategoryName,
}) {
  return [
    initialsPart(companyName),
    compactSegment(departmentCode || departmentName),
    compactSegment(categoryCode || categoryName),
    compactSegment(subcategoryCode || subcategoryName),
  ].join("-");
}

function createInventoryNumber(input, sequence) {
  const prefix = buildInventoryPrefix(input);
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

module.exports = {
  compactSegment,
  initialsPart,
  slugPart,
  buildInventoryPrefix,
  createInventoryNumber,
};
