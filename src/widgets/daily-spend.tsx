import { Button, Column, Image, Row, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, height, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';

export type DailySpendProps = {
  /** file:// PNG drawn by WidgetCharts.kt. Empty until the listener first runs. */
  chart: string;
  total: string;
};

// Props come from the native listener (WidgetBridge.kt / WidgetCharts.kt), so the widget updates with the app closed.
const DailySpend = (props: DailySpendProps) => {
  'widget';
  return (
    // A full-size button so a tap anywhere opens the app (the "open:" target comes from patches/expo-widgets).
    <Button {...({ target: 'open:projectbalance://' } as object)} modifiers={[fillMaxSize(), background('#1A1614'), cornerRadius(20)]}>
      <Column modifiers={[fillMaxSize(), paddingAll(12)]}>
        <Row>
          <Text color="#F3EBE2" style={{ fontSize: 15, fontWeight: '700' }}>
            {props.total}
          </Text>
          <Text color="#AC9F92" style={{ fontSize: 13 }}>
            {' in 30d'}
          </Text>
        </Row>
        <Spacer modifiers={[height(4)]} />
        {props.chart ? (
          <Image
            source={{ uri: props.chart }}
            contentScale="fit"
            contentDescription="Daily spending last 30 days"
            modifiers={[fillMaxSize()]}
          />
        ) : (
          <Text color="#AC9F92" style={{ fontSize: 13 }}>
            Open Balance once.
          </Text>
        )}
      </Column>
    </Button>
  );
};

export default createWidget<DailySpendProps>('DailySpend', DailySpend, {
  chart: '',
  total: '0',
});
