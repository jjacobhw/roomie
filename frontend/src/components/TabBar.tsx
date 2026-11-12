import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';

const ICON_SIZE = 22;
// Space around the icons and labels, before adding the phone's bottom edge. The bar splits all of
// it (this plus the bottom inset) evenly above and below, so the icons sit centered between the
// divider line and the bottom of the screen.
const BASE_VERTICAL_PADDING = 14;

export type Tab<K extends string> = {
  key: K;
  label: string;
  // Draws the tab's icon in the color the bar picks (active or inactive).
  icon: (props: { size: number; color: string }) => ReactNode;
};

type Props<K extends string> = {
  tabs: Tab<K>[];
  active: K;
  onChange: (key: K) => void;
  // Height of the phone's bottom edge (home indicator). The bar's white background extends
  // through it, so there's no strip of the page color under the bar.
  bottomInset?: number;
};

// The bar at the bottom of the screen for switching between the app's main sections.
export function TabBar<K extends string>({ tabs, active, onChange, bottomInset = 0 }: Props<K>) {
  const verticalPadding = (BASE_VERTICAL_PADDING + bottomInset) / 2;
  return (
    <View style={[styles.bar, { paddingTop: verticalPadding, paddingBottom: verticalPadding }]}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={styles.tab}
          >
            {tab.icon({ size: ICON_SIZE, color: selected ? colors.primary : colors.textFaint })}
            <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
