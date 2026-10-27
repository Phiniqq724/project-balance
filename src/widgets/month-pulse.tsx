import { Button, Column, Spacer, Text } from '@expo/ui/jetpack-compose';
import { background, cornerRadius, fillMaxSize, height, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';

export type MonthPulseProps = {
  month: string;
  spent: string;
  received: string;
  today: string;
};

// Props are written by the native listener (WidgetBridge.kt), so the widget updates with the app closed.
const MonthPulse = (props: MonthPulseProps) => {
  'widget';
  return (
    // A full-size button so a tap anywhere opens the app (the "open:" target comes from patches/expo-widgets).
    <Button {...({ target: 'open:projectbalance://' } as object)} modifiers={[fillMaxSize(), background('#0B0D0E'), cornerRadius(20)]}>
      <Column modifiers={[fillMaxSize(), paddingAll(14)]}>
        <Text color="#8F989E" style={{ fontSize: 12 }}>
          {props.month}
        </Text>
        <Spacer modifiers={[height(6)]} />
        <Text color="#E6EAEC" style={{ fontSize: 28, fontWeight: '700' }}>
          {props.spent}
        </Text>
        <Text color="#8F989E" style={{ fontSize: 12 }}>
          spent
        </Text>
        <Spacer modifiers={[height(10)]} />
        <Text color="#39D353" style={{ fontSize: 13, fontWeight: '500' }}>
          {`+${props.received} in`}
        </Text>
        <Text color="#8F989E" style={{ fontSize: 13 }}>
          {`${props.today} today`}
        </Text>
      </Column>
    </Button>
  );
};

export default createWidget<MonthPulseProps>('MonthPulse', MonthPulse, {
  month: '',
  spent: '0',
  received: '0',
  today: '0',
});
