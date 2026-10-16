// The hand-ported wireframe modules (spec 04 §5.3). One file per Lua script, named after it in
// kebab case (`android_actionbar.lua` → `android-actionbar.ts`, key `wireframe/android_actionbar`), whose
// default export is the module; `tools/build-generator-scripts.mjs` bundles each file into its
// canonical JS text. The rest of the 33 are ported by tasks G2-G4: until a script's module is
// listed here, a template that uses it loads as a placeholder (`lua_unknown_id`).
import type { WireframeModule } from '../../template';
import accordion from './accordion';
import androidActionbar from './android-actionbar';
import androidDatepicker from './android-datepicker';
import androidTabbar from './android-tabbar';
import breadcrumbs from './breadcrumbs';
import button from './button';
import buttonBar from './button-bar';
import calendar from './calendar';
import checkbox from './checkbox';
import checkboxGroup from './checkbox-group';
import datagrid from './datagrid';
import iosActionsheet from './ios-actionsheet';
import iosContextmenu from './ios-contextmenu';
import iosMenu from './ios-menu';
import iosPagecontrol from './ios-pagecontrol';
import iosPicker from './ios-picker';
import iosSegmented from './ios-segmented';
import linkBar from './link-bar';
import listbox from './listbox';
import menu from './menu';
import menuBar from './menu-bar';
import multilineButton from './multiline-button';

/** In the order of spec 04 §5.3's table. */
export const WIREFRAME_MODULES: readonly WireframeModule[] = Object.freeze([
  accordion,
  androidActionbar,
  androidDatepicker,
  androidTabbar,
  breadcrumbs,
  button,
  buttonBar,
  calendar,
  checkbox,
  checkboxGroup,
  datagrid,
  iosActionsheet,
  iosContextmenu,
  iosMenu,
  iosPagecontrol,
  iosPicker,
  iosSegmented,
  linkBar,
  listbox,
  menu,
  menuBar,
  multilineButton,
]);
