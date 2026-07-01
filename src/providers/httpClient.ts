/**
 * 通用 HTTP GET 工具（支持 GBK 解码）
 * 新浪/腾讯 API 均返回 GBK 编码，需用 TextDecoder 解码
 */

import * as https from 'https';

/**
 * 发送 HTTPS GET 请求，返回解码后的字符串
 * @param url 请求 URL
 * @param headers 请求头
 * @param encoding 文本编码，默认 gbk（新浪/腾讯都是 GBK）
 */
export function httpGet(
  url: string,
  headers: Record<string, string> = {},
  encoding: string = 'gbk',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try {
          const decoder = new TextDecoder(encoding);
          const text = decoder.decode(buf);
          resolve(text);
        } catch {
          // 如果 TextDecoder 不支持该编码，退回 utf-8
          resolve(buf.toString('utf-8'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
  });
}
