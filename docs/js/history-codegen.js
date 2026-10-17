function csvBlock(file) {
  const name = JSON.stringify(file.name);
  const lines = [
    `const rows = readCsv(files[${name}]);`,
    `for (let i = ${file.dataStartRow}; i < rows.length; i++) {`,
    "  if (out.length >= MAX) break;",
    "  const row = rows[i];",
    `  let title = cell(row, ${file.titleColumn});`
  ];
  if (file.titlePrefix) {
    const prefix = JSON.stringify(file.titlePrefix);
    lines.push(`  if (title.startsWith(${prefix})) title = title.slice(${prefix}.length).trim();`);
  }
  lines.push("  if (!title) continue;");
  const date = file.dateColumn === null
    ? "null"
    : `readDate(cell(row, ${file.dateColumn}), ${JSON.stringify(file.dateFormat)})`;
  const type = file.typeColumn === null ? "null" : `cell(row, ${file.typeColumn}) || null`;
  const series = file.seriesColumn === null ? "null" : `cell(row, ${file.seriesColumn}) || null`;
  lines.push(`  out.push({ file: ${name}, title, date: ${date}, type: ${type}, series: ${series} });`);
  lines.push("}");
  return lines.join("\n");
}

function jsonBlock(file) {
  const name = JSON.stringify(file.name);
  const lines = [
    `let records = readJson(files[${name}]);`,
    `const segments = ${JSON.stringify(file.recordsPath)};`,
    "for (const segment of segments) records = records && records[segment];",
    "if (Array.isArray(records)) {",
    "  for (const record of records) {",
    "    if (out.length >= MAX) break;",
    `    let title = field(record, ${JSON.stringify(file.titlePath)});`
  ];
  if (file.titlePrefix) {
    const prefix = JSON.stringify(file.titlePrefix);
    lines.push(`    if (title.startsWith(${prefix})) title = title.slice(${prefix}.length).trim();`);
  }
  lines.push("    if (!title) continue;");
  const date = file.datePath === null
    ? "null"
    : `readDate(field(record, ${JSON.stringify(file.datePath)}), ${JSON.stringify(file.dateFormat)})`;
  const type = file.typePath === null ? "null" : `field(record, ${JSON.stringify(file.typePath)}) || null`;
  const series = file.seriesPath === null ? "null" : `field(record, ${JSON.stringify(file.seriesPath)}) || null`;
  lines.push(`    out.push({ file: ${name}, title, date: ${date}, type: ${type}, series: ${series} });`);
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}

function htmlBlock(file) {
  const name = JSON.stringify(file.name);
  const lines = [
    `const blocks = readHtml(files[${name}]);`,
    "for (const block of blocks) {",
    "  if (out.length >= MAX) break;",
    `  if (!block.classes || !block.classes.includes(${JSON.stringify(file.itemClass)})) continue;`
  ];
  for (const skip of file.skipIncludes) {
    lines.push(`  if (block.text.includes(${JSON.stringify(skip)})) continue;`);
  }
  lines.push(`  const link = block.links[${file.titleLink}];`);
  lines.push(file.requireHref ? "  if (!link || !link.href) continue;" : "  if (!link) continue;");
  lines.push("  const title = String(link.text || \"\").trim();");
  lines.push("  if (!title) continue;");
  lines.push(`  out.push({ file: ${name}, title, date: null, type: null, series: null });`);
  lines.push("}");
  return lines.join("\n");
}

export function generateHistoryExtractorSource(plan) {
  const blocks = ["\"use strict\";", "const out = [];"];
  for (const file of plan.files) {
    if (file.format === "csv") blocks.push(csvBlock(file));
    else if (file.format === "html") blocks.push(htmlBlock(file));
    else blocks.push(jsonBlock(file));
  }
  blocks.push("return out;");
  return blocks.join("\n");
}
