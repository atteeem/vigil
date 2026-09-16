"use client";

import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

export function MarketPriceChart({ series, up }: { series: number[]; up: boolean }) {
  const data = series.map((v, i) => ({ i, v }));
  const color = up ? "#3DDC84" : "#EF4B4B";
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={["auto", "auto"]} hide />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill="url(#priceFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
