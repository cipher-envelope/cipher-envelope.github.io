import { expect, test } from 'vitest';
import { paletteCss } from '../src/ui/palette';

// An insecure method is shown in red (docs/standards.md): styles.css paints it with these custom
// properties, so each must be written under the name the stylesheet reads.

test('the light scheme defines the alarm background red', () => {
  expect(paletteCss()).toContain('--alarm-bg: #c8102e;');
});
test('the dark scheme defines its own alarm background red', () => {
  expect(paletteCss()).toContain('--alarm-bg: #b3122b;');
});
