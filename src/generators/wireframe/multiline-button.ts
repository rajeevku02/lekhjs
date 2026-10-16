// `wireframe/multiline_button` (spec 04 §5.3 row 22): hand port of `multiline_button.lua`
// (template `avabodh.wireframe.multilinebutton`). A white button with the first text line, and the
// second line below it at 0.75 of the font size; further lines are ignored.
import type { WireframeModule } from '../../template';

const multilineButton: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/multiline_button',
  generate({ text }, h) {
    const arr = h.splitLines(text);
    const first = arr[0] ?? '';
    const second = arr[1] ?? '';
    const s1 = h.textSize(first);
    const s2 = h.textSize(second);
    let wd = s1.w;
    if (s2.w * 0.75 > wd) wd = s2.w * 0.75;
    return {
      data: [
        '-w/2',
        '-h/2',
        '-w/2',
        'h/2',
        'w/2',
        'h/2',
        'w/2',
        '-h/2',
        '0',
        '-th(0,w)/2',
        'w',
        'th(0,w)',
        '0',
        '0',
        'th(1,w)',
        'w',
        'th(1,w)',
        '0',
      ],
      draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }],
      texts: [
        { text: first, location: '8 9 10 11 12' },
        { text: second, location: '13 14 15 16 17', style: { fontmultiplier: 0.75 } },
      ],
      images: [],
      embeds: [],
      containers: [],
      minW: wd + 8,
      minH: s1.h + s2.h + 8,
    };
  },
});

export default multilineButton;
