/** tracer(2D 描圖工具) 專用配色——viewer(3D) 已改由 theme.ts 驅動 */
export const AREA_COLORS: Record<string, string> = {
  platform: '#e8c060', paid: '#e3547a', unpaid: '#4a90d9',
  corridor: '#7bc47f', track: '#333a45', restricted: '#777777',
};

export const GATE_COLORS = { accessible: '#2bb3a3', standard: '#c05050' } as const;
