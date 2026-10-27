import { Button, Column, Image, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, height, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';

export type SpendGridProps = {
  weeks: number;
  /** file:// PNG drawn by WidgetBridge.kt at the widget's size. Empty until the listener first runs. */
  grid: string;
  total: string;
  today: string;
};

// Props come from the native listener (WidgetBridge.kt), so the widget updates with the app closed.
// The grid is a bitmap because Glance caps a Row/Column at 10 children and the layout can't see its size.
const SpendGrid = (props: SpendGridProps) => {
  'widget';
  return (
    // A full-size button so a tap anywhere opens the app (the "open:" target comes from patches/expo-widgets).
    <Button {...({ target: 'open:projectbalance://' } as object)} modifiers={[fillMaxSize(), background('#1A1614'), cornerRadius(20)]}>
      <Column modifiers={[fillMaxSize(), paddingAll(14)]}>
        <Row>
          <Text color="#F3EBE2" style={{ fontSize: 15, fontWeight: '700' }}>
            {props.total}
          </Text>
          <Text color="#AC9F92" style={{ fontSize: 13 }}>
            {` in ${props.weeks} weeks  ·  ${props.today} today`}
          </Text>
        </Row>
        <Spacer modifiers={[height(8)]} />
        {props.grid ? (
          <Image
            source={{ uri: props.grid }}
            contentScale="fit"
            contentDescription={`Daily spending, last ${props.weeks} weeks`}
            modifiers={[fillMaxSize()]}
          />
        ) : (
          <Text color="#AC9F92" style={{ fontSize: 13 }}>
            Open Balance once to draw the grid.
          </Text>
        )}
      </Column>
    </Button>
  );
};

export default createWidget<SpendGridProps>('SpendGrid', SpendGrid, {
  weeks: 0,
  grid: '',
  total: '0',
  today: '0',
});
