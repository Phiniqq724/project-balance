import { Box, Column, Row } from '@expo/ui/jetpack-compose';
import { background, clip, height, Shapes, size, width } from '@expo/ui/jetpack-compose/modifiers';
import { useWindowDimensions } from 'react-native';

import { Label } from '@/components/kit';
import type { HeatCell } from '@/lib/heatmap';
import { color, space } from '@/theme';

const GAP = 3;
const LABEL_WIDTH = 18;
const WEEKDAYS = ['M', '', 'W', '', 'F', '', 'S'];

function cellColor(level: number) {
  return level < 0 ? color.bg : color.heat[level];
}

/** The spending grid, Monday on top. Cells size themselves to fill the screen width. */
export function Heatmap({ columns }: { columns: HeatCell[][] }) {
  const window = useWindowDimensions();
  const cell = Math.floor((window.width - space.page * 2 - LABEL_WIDTH - GAP * (columns.length - 1)) / columns.length);

  return (
    <Row horizontalArrangement={{ spacedBy: GAP }}>
      <Column verticalArrangement={{ spacedBy: GAP }} modifiers={[width(LABEL_WIDTH - GAP)]}>
        {WEEKDAYS.map((d, i) => (
          <Box key={i} modifiers={[height(cell)]} contentAlignment="centerStart">
            <Label size={10} weight="medium" tone="muted">
              {d}
            </Label>
          </Box>
        ))}
      </Column>
      {columns.map((week) => (
        <Column key={week[0].date.getTime()} verticalArrangement={{ spacedBy: GAP }}>
          {week.map((day) => (
            <Box
              key={day.date.getTime()}
              modifiers={[size(cell, cell), clip(Shapes.RoundedCorner(3)), background(cellColor(day.level))]}
            />
          ))}
        </Column>
      ))}
    </Row>
  );
}

export function HeatLegend() {
  return (
    <Row horizontalArrangement={{ spacedBy: GAP }}>
      {color.heat.map((c) => (
        <Box key={c} modifiers={[size(10, 10), clip(Shapes.RoundedCorner(2)), background(c)]} />
      ))}
    </Row>
  );
}
