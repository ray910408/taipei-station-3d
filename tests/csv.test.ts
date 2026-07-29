import { describe, it, expect } from 'vitest';
import { parseCsv } from '../tools/csv';

/** `tools/csv.ts` 的單元測試。opendata 稽核（`tests/opendata-joinkeys.test.ts`）與
 *  frame-bearing 稽核都靠這個 parser 把畸形輸入攔下來、而不是無聲吃掉，
 *  所以 parser 本身的邊界行為要有測試釘住，不能只靠現有 CSV 剛好乾淨來掩護。 */

describe('parseCsv', () => {
  it('引號欄含合法逗號時視為單一欄位', () => {
    const { rows, malformed } = parseCsv('a,"b,c",d\n');
    expect(rows).toEqual([['a', 'b,c', 'd']]);
    expect(malformed).toEqual([]);
  });

  it('"" 跳脫引號會還原成內容裡的一個引號', () => {
    const { rows, malformed } = parseCsv('a,"b""c",d\n');
    expect(rows).toEqual([['a', 'b"c', 'd']]);
    expect(malformed).toEqual([]);
  });

  it('CRLF 行尾的檔案列內容乾淨、\\r 不會混進內容', () => {
    const { rows, malformed } = parseCsv('a,b\r\nc,d\r\n');
    expect(rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(malformed).toEqual([]);
  });

  it('檔尾引號未收視為畸形', () => {
    const { malformed } = parseCsv('a,"b');
    expect(malformed).toEqual(['檔尾引號未收']);
  });

  it('收尾引號後接雜字視為畸形（"月臺層"x）', () => {
    const { malformed } = parseCsv('"月臺層"x\n');
    expect(malformed.length).toBe(1);
    expect(malformed[0]).toContain('收尾引號後接了');
  });

  it('引號從欄位中途才開始視為畸形（月臺"層"）', () => {
    const { malformed } = parseCsv('月臺"層"\n');
    expect(malformed.length).toBe(1);
    expect(malformed[0]).toContain('引號從欄位中途開始');
  });

  it('未引號區出現孤立的 \\r（非 CRLF）視為畸形，且該字元被丟棄不進內容', () => {
    const { rows, malformed } = parseCsv('a\rb,c\n');
    expect(malformed.length).toBe(1);
    expect(malformed[0]).toContain('孤立的 \\r');
    expect(rows).toEqual([['ab', 'c']]);
  });

  it('收尾引號後接孤立的 \\r 一樣走孤立 \\r 規則抓出來（"月臺層"\\rx）', () => {
    const { malformed } = parseCsv('"月臺層"\rx\n');
    expect(malformed.length).toBe(1);
    expect(malformed[0]).toContain('孤立的 \\r');
  });

  it('引號內的 \\r\\n（含引號內 CRLF）維持原樣當內容保留', () => {
    const { rows, malformed } = parseCsv('"a\r\nb",c\n');
    expect(rows).toEqual([['a\r\nb', 'c']]);
    expect(malformed).toEqual([]);
  });

  it('CRLF 檔尾不產生幽靈列', () => {
    const { rows, malformed } = parseCsv('a,b\r\nc,d\r\n');
    expect(rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(malformed).toEqual([]);
  });

  it('檔尾無換行的引號空記錄不會整筆消失', () => {
    const { rows, malformed } = parseCsv('a,b\n""');
    expect(rows).toEqual([['a', 'b'], ['']]);
    expect(malformed).toEqual([]);
  });

  it('整份輸入只有一個引號空記錄、無結尾換行', () => {
    const { rows, malformed } = parseCsv('""');
    expect(rows).toEqual([['']]);
    expect(malformed).toEqual([]);
  });
});
