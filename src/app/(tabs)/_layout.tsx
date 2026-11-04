import {
  AnimatedVisibility,
  Badge,
  BadgedBox,
  Box,
  EnterTransition,
  ExitTransition,
  FloatingActionButton,
  HorizontalFloatingToolbar,
  Host,
  Icon,
  Row,
  Text,
} from '@expo/ui/jetpack-compose';
import { animateContentSize, background, clickable, clip, fillMaxWidth, matchParentSize, padding, Shapes } from '@expo/ui/jetpack-compose/modifiers';
import Add from '@expo/material-symbols/add.xml';
import Activity from '@expo/material-symbols/receipt_long.xml';
import Overview from '@expo/material-symbols/monitoring.xml';
import Person from '@expo/material-symbols/person.xml';
import { router, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getUnparsedCount } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import { SheetSlot } from '@/components/kit';
import { NewTxSheet } from '@/components/new-tx-sheet';
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

/** Same bar as manage-kontrakan: a pill of tabs, with the add button beside it on Activity only. */
function FloatingBar({ bottom }: { bottom: number }) {
  const pathname = usePathname();
  const index = Math.max(0, TABS.findIndex((tab) => tab.href === pathname));
  const [adding, setAdding] = useState(false);
  // Narrow phones (~360dp) get tighter item padding so the pill and button fit.
  const itemPad = useWindowDimensions().width < 380 ? 10 : 14;
  // Same count as "To check" in Activity; live through the ledger-changed event.
  const unsettled = useLedger(getUnparsedCount);
  const toCheck = unsettled.status === 'ready' ? unsettled.data : 0;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center' }}>
      {/* Full-width host that only sizes vertically, so the pill's shadow and label animation never clip. */}
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="dark" colorOverrides={materialOverrides}>
        <Box contentAlignment="center" modifiers={[fillMaxWidth()]}>
          <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }} modifiers={[padding(0, 8, 0, 8), animateContentSize()]}>
            <HorizontalFloatingToolbar colors={{ toolbarContainerColor: color.raised }}>
              {TABS.map((tab, i) => {
                const focused = i === index;
                const tint = focused ? color.text : color.muted;
                const icon = <Icon source={tab.icon} size={24} tint={tint} contentDescription={tab.label} />;
                return (
                  <Box key={tab.name}>
                    {/* Pill and ripple clip on a layer behind the content, so the badge past the icon's corner isn't cut off. */}
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
                    <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 6 }} modifiers={[padding(itemPad, 10, itemPad, 10)]}>
                      {tab.name === 'activity' && toCheck > 0 ? (
                        <BadgedBox>
                          {icon}
                          <BadgedBox.Badge>
                            <Badge containerColor={color.accent}>
                              <Text style={{ typography: 'labelSmall' }} color={color.bg}>
                                {toCheck > 99 ? '99+' : String(toCheck)}
                              </Text>
                            </Badge>
                          </BadgedBox.Badge>
                        </BadgedBox>
                      ) : (
                        icon
                      )}
                      <AnimatedVisibility
                        visible={focused}
                        enterTransition={EnterTransition.fadeIn().plus(EnterTransition.expandHorizontally())}
                        exitTransition={ExitTransition.fadeOut().plus(ExitTransition.shrinkHorizontally())}>
                        <Text color={tint} maxLines={1} style={{ typography: 'labelLarge', fontFamily: font.bold, fontWeight: 'bold' }}>
                          {tab.label}
                        </Text>
                      </AnimatedVisibility>
                    </Row>
                  </Box>
                );
              })}
            </HorizontalFloatingToolbar>

            <AnimatedVisibility
              visible={pathname === '/activity'}
              enterTransition={EnterTransition.scaleIn().plus(EnterTransition.fadeIn())}
              exitTransition={ExitTransition.scaleOut().plus(ExitTransition.fadeOut())}>
              <FloatingActionButton containerColor={color.accent} onClick={() => setAdding(true)}>
                <FloatingActionButton.Icon>
                  <Icon source={Add} size={24} tint={color.bg} contentDescription="New transaction" />
                </FloatingActionButton.Icon>
              </FloatingActionButton>
            </AnimatedVisibility>
          </Row>
          <SheetSlot>{adding && <NewTxSheet onClose={() => setAdding(false)} />}</SheetSlot>
        </Box>
      </Host>
    </View>
  );
}
