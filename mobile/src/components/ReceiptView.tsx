import { StyleSheet, Text, View } from 'react-native';
import {
  INK_ROW_HEIGHT, INK_STROKE_DOTS, RASTER, inkMaxWidth, type ReceiptDoc,
} from '@shridhar/shared';
import { InkView } from './InkView';
import { C } from '../theme';

/**
 * The receipt as it will print, from the same document the printer gets.
 *
 * Sizes in the document are printer dots, so one scale factor converts the whole thing -- which is
 * what keeps the preview honest about what comes out of the paper, on either roll width.
 */
export function ReceiptView({ doc, width = 300 }: { doc: ReceiptDoc; width?: number }) {
  const dot = width / doc.width;
  const px = (n: number) => Math.round(n * dot * 100) / 100;

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
            <View key={i} style={styles.kv}>
              <Text style={[styles.text, st]}>{row.left}</Text>
              <Text style={[styles.text, st]}>{row.right}</Text>
            </View>
          );
        }

        const size = px(RASTER.itemSize);
        const st = { fontSize: size, lineHeight: size * 1.5 };
        return (
          <View key={i} style={styles.item}>
            <Text style={[styles.text, st, { width: px(RASTER.qtyCol) }]}>{row.no}</Text>
            <View style={styles.middle}>
              {row.t === 'ink' ? (
                <InkView
                  ink={row.ink}
                  height={px(INK_ROW_HEIGHT)}
                  maxWidth={px(inkMaxWidth(doc.width))}
                  strokeDots={px(INK_STROKE_DOTS)}
                />
              ) : (
                <Text style={[styles.text, st]}>{row.name}</Text>
              )}
              {row.note ? (
                <Text style={[styles.text, { fontSize: px(18), lineHeight: px(18) * 1.5, color: '#555' }]}>
                  {row.note}
                </Text>
              ) : null}
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    alignSelf: 'center',
  },
  text: { color: '#000' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  item: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  middle: { flex: 1, paddingRight: 8 },
  sep: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#8a8a8a', marginVertical: 5 },
});
