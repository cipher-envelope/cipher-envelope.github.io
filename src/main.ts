import './fonts/fonts.css';
import './styles.css';
import { handwritingCss } from './ui/drawings';
import { paletteCss } from './ui/palette';
import { mountWorkbench } from './ui/workbench';

document.head.append(Object.assign(document.createElement('style'), { textContent: paletteCss() + handwritingCss() }));

const root = document.getElementById('app');
if (!root) throw new Error('The page has no #app element.');
mountWorkbench(root);
