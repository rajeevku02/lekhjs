// The wireframe generator templates and their Lua sources (spec 04 §5.3, §7.2), re-derived from
// `lekhboard/stencils/v4/wireframe.json`: 34 template ids served by 33 scripts (`slider` and
// `iosslider` share one). A module key is `wireframe/<the Lua script's base name>`, so it matches
// the marker's key syntax `[a-z0-9/_-]+`.
//
// The scriptfile table only proves a Lua script was meant (a `v2.2.x`–`v4` stencil entry, or a
// hand-authored fixture); dispatch is always by template id. `common_min.lua` is the packed desktop
// dev stub that no template references: it maps to no module.
import type { WireframeKey } from '../template';

/** One generator template: its id, its module key and the Lua file a stencil names. */
export interface WireframeTemplateRow {
  readonly id: string;
  readonly key: WireframeKey;
  /** The `scriptfile` of the `v4` stencil entry. */
  readonly scriptfile: string;
}

const P = 'avabodh.wireframe.';

function row(name: string, lua: string): WireframeTemplateRow {
  return Object.freeze({ id: P + name, key: `wireframe/${lua}` as const, scriptfile: `wireframe/${lua}_min.lua` });
}

/** The 34 rows, in `v4/wireframe.json` order. */
export const WIREFRAME_TEMPLATES: readonly WireframeTemplateRow[] = Object.freeze([
  row('calendar', 'calendar'),
  row('androiddatepicker', 'android_datepicker'),
  row('androidtabbar', 'android_tabbar'),
  row('androidactionbar', 'android_actionbar'),
  row('iosactionsheet', 'ios_actionsheet'),
  row('iossegmented', 'ios_segmented'),
  row('iosslider', 'slider'),
  row('iospagecontrol', 'ios_pagecontrol'),
  row('ioscontextmenu', 'ios_contextmenu'),
  row('tooltip', 'tooltip'),
  row('slider', 'slider'),
  row('vslider', 'vslider'),
  row('pointybutton', 'pointy_button'),
  row('multilinebutton', 'multiline_button'),
  row('listbox', 'listbox'),
  row('button', 'button'),
  row('buttonbar', 'button_bar'),
  row('menubar', 'menu_bar'),
  row('checkbox', 'checkbox'),
  row('radiobutton', 'radio_button'),
  row('checkboxgroup', 'checkbox_group'),
  row('radiobuttongroup', 'radiobutton_group'),
  row('menu', 'menu'),
  row('iosmenu', 'ios_menu'),
  row('tree', 'tree'),
  row('datagrid', 'datagrid'),
  row('iospicker', 'ios_picker'),
  row('linkbar', 'link_bar'),
  row('breadcrumbs', 'breadcrumbs'),
  row('tabshead', 'tabbar'),
  row('tabs', 'tabs'),
  row('vtabs', 'vtabs'),
  row('accordion', 'accordion'),
  row('iospopover', 'popover'),
]);

/** The packed dev stub: a Lua scriptfile that names no module. */
export const UNUSED_SCRIPTFILE = 'wireframe/common_min.lua';

/** The 7 native generator names (`CppShapeGenerator::getGenerator`, spec 04 §6). */
export const NATIVE_SHAPES: readonly string[] = Object.freeze([
  'bpmn.activity',
  'bpmn.event',
  'bpmn.gateway',
  'bpmn.conversation',
  'bpmn.dataobject',
  'bpmn.choreography',
  'table-v1',
]);
