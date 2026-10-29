import {
  AnimatedVisibility,
  Box,
  EnterTransition,
  ExitTransition,
  HorizontalFloatingToolbar,
  Host,
  Icon,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import { background, clickable, clip, fillMaxWidth, matchParentSize, padding, Shapes } from '@expo/ui/jetpack-compose/modifiers';
import Activity from '@expo/material-symbols/receipt_long.xml';
import Overview from '@expo/material-symbols/monitoring.xml';
import Person from '@expo/material-symbols/person.xml';
import { router, usePathname, type Href } from 'expo-router';
import { TopTabs } from 'expo-router/js-top-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, materialOverrides } from '@/theme';

const TABS = [
  { name: 'index', href: '/', label: 'Overview', icon: Overview },
  { name: 'activity', href: '/activity', label: 'Activity', icon: Activity },
  { name: 'profile', href: '/profile', label: 'Profile', icon: Person },
] as const;

// Swipeable pages like manage-kontrakan. The pager draws no bar of its own; the floating pill sits
// over it and only follows the route, so nothing runs on the JS thread while a swipe is in flight.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopTabs tabBarPosition="bottom" tabBar={() => null} screenOptions={{ sceneStyle: { backgroundColor: color.bg } }}>
        {TABS.map((tab) => (
          <TopTabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
        ))}
      </TopTabs>
      <FloatingBar bottom={insets.bottom + 4} />
      {/* Solid strip behind the gesture bar so pages never show through it. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: color.bg }}
      />
    </View>
  );
}

/** Same pill as manage-kontrakan: icons only, the open tab expands to show its label. */
function FloatingBar({ bottom }: { bottom: number }) {
  const pathname = usePathname();
  const index = Math.max(0, TABS.findIndex((tab) => tab.href === pathname));

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center' }}>
      {/* Full-width host that only sizes vertically, so the pill's shadow and label animation never clip. */}
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="dark" colorOverrides={materialOverrides}>
        <Box contentAlignment="center" modifiers={[fillMaxWidth(), padding(0, 8, 0, 8)]}>
          <HorizontalFloatingToolbar colors={{ toolbarContainerColor: color.raised }}>
            {TABS.map((tab, i) => {
              const focused = i === index;
              const tint = focused ? color.text : color.muted;
              return (
                <Box key={tab.name}>
                  <Box
                    modifiers={[
                      matchParentSize(),
                      clip(Shapes.RoundedCorner(20)),
                      background(focused ? color.selected : 'transparent'),
                      clickable(() => {
                        if (!focused) router.navigate(tab.href as Href);
                      }),
                    ]}
                  />
                  <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 6 }} modifiers={[padding(14, 10, 14, 10)]}>
                    <Icon source={tab.icon} size={24} tint={tint} contentDescription={tab.label} />
                    <AnimatedVisibility
                      visible={focused}
                      enterTransition={EnterTransition.fadeIn().plus(EnterTransition.expandHorizontally())}
                      exitTransition={ExitTransition.fadeOut().plus(ExitTransition.shrinkHorizontally())}>
                      <Text color={tint} maxLines={1} style={{ fontFamily: font.bold, fontSize: 14 }}>
                        {tab.label}
                      </Text>
                    </AnimatedVisibility>
                  </Row>
                </Box>
              );
            })}
          </HorizontalFloatingToolbar>
        </Box>
      </Host>
    </View>
  );
}
