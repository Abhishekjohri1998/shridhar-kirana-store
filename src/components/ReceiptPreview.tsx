import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ReceiptDoc } from '../receipt/doc';
import { PAPER_WIDTH } from '../receipt/doc';
import { C } from '../theme';

/**
 * Draws the same ReceiptDoc the printer gets, scaled down to the screen. Sizes in the doc are
 * printer dots, so one scale factor converts the whole thing -- which is what keeps the preview
 * honest about what will come out of the paper.
 */
export function ReceiptPreview({ doc, width = 300 }: { doc: ReceiptDoc; width?: number }) {
  const s = width / PAPER_WIDTH;
  const px = (n: number) => Math.round(n * s * 100) / 100;

  return (
    <View style={[styles.paper, { width }]}>
      {doc.rows.map((row, i) => {
        if (row.t === 'space') return <View key={i} style={{ height: px(row.h) }} />;

        if (row.t === 'sep') return <View key={i} style={styles.sep} />;

        if (row.t === 'center') {
          const size = px(row.size ?? 22);
          return (
            <Text
              key={i}
              style={[styles.text, { fontSize: size, lineHeight: size * 1.5, textAlign: 'center', fontWeight: row.bold ? '700' : '400' }]}
            >
              {row.text}
            </Text>
          );
        }

        if (row.t === 'kv') {
          const size = px(row.size ?? 22);
          const st = { fontSize: size, lineHeight: size * 1.5, fontWeight: row.bold ? ('700' as const) : ('400' as const) };
          return (
            <View key={i} style={styles.row}>
              <Text style={[styles.text, st]}>{row.left}</Text>
              <Text style={[styles.text, st]}>{row.right}</Text>
            </View>
          );
        }

        const size = px(24);
        const st = { fontSize: size, lineHeight: size * 1.5 };
        return (
          <View key={i} style={styles.itemRow}>
            <Text style={[styles.text, st, { width: px(44) }]}>{row.qty}</Text>
            <View style={styles.itemMiddle}>
              <Text style={[styles.text, st]}>{row.name}</Text>
              {row.note ? <Text style={[styles.text, { fontSize: px(18), lineHeight: px(18) * 1.5, color: C.soft }]}>{row.note}</Text> : null}
            </View>
            <Text style={[styles.text, st]}>{row.amount}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    backgroundColor: C.paper,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    alignSelf: 'center',
  },
  text: { color: '#000' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  itemMiddle: { flex: 1, paddingRight: 8 },
  sep: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#8a8a8a', marginVertical: 5 },
});
