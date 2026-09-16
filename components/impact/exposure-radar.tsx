"use client";

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { ImpactComponent } from "@/lib/types";
import { DIMENSION_LABEL } from "@/lib/data/impact";

export function ExposureRadar({ components }: { components: ImpactComponent[] }) {
  const data = components.map((c) => ({
    dimension: DIMENSION_LABEL[c.dimension],
    value: c.value,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: "#8D96A5", fontSize: 12 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: "#5E6672", fontSize: 10 }}
            axisLine={false}
          />
          <Radar
            dataKey="value"
            stroke="#4CC2FF"
            fill="#4CC2FF"
            fillOpacity={0.22}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
