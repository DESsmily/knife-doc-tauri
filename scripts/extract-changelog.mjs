#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从 CHANGELOG.md 中提取指定版本的变更日志内容
 * 用法: node scripts/extract-changelog.mjs <tag>
 * 示例: node scripts/extract-changelog.mjs v0.0.2
 * @param {string} tag - Git 标签名称（如 v0.0.2）
 */
function extractChangelog(tag) {
  if (!tag) {
    console.error('错误: 必须提供版本标签参数，例如 v0.0.2');
    process.exit(1);
  }

  // 从 tag 中提取版本号，去掉前缀 'v'（如 v0.0.2 -> 0.0.2）
  const version = tag.replace(/^v/, '');

  // CHANGELOG.md 路径（相对于项目根目录）
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const changelogPath = resolve(__dirname, '..', 'CHANGELOG.md');

  // 读取 CHANGELOG.md 内容
  let content;
  try {
    content = readFileSync(changelogPath, 'utf-8');
  } catch (err) {
    console.error(`错误: 无法读取 CHANGELOG.md - ${err.message}`);
    process.exit(1);
  }

  // 匹配版本标题行，格式为: ## [0.0.2] 或 ## [0.0.2] - 当前版本
  const versionHeadingRegex = new RegExp(
    `^## \\[${escapeRegex(version)}\\].*$`,
    'm'
  );

  // 查找目标版本标题位置
  const match = content.match(versionHeadingRegex);
  if (!match) {
    console.error(`错误: 在 CHANGELOG.md 中未找到版本 ${version}`);
    process.exit(1);
  }

  // 截取从目标标题到下一个 ## [ 标题之间的内容
  const startIndex = match.index + match[0].length;
  const remaining = content.slice(startIndex);

  // 匹配下一个版本标题行
  const nextHeadingRegex = /^## \[/m;
  const nextMatch = remaining.match(nextHeadingRegex);

  // 如果有下一个版本标题，截取到那里为止；否则取剩余全部内容
  const endIndex = nextMatch ? nextMatch.index : remaining.length;
  const section = remaining.slice(0, endIndex).trim();

  // 输出结果
  process.stdout.write(section + '\n');
}

/**
 * 转义正则表达式中的特殊字符
 * @param {string} str - 需要转义的字符串
 * @returns {string} - 转义后的字符串
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 获取命令行参数并执行
const tag = process.argv[2];
extractChangelog(tag);
