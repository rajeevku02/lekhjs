// A floating text box sized by its text (port of C++ `TextTemplate`, `L/ShapeTemplate.cpp:1585-1626`).
import { Size } from '../../geometry';
import { Style } from '../../style';
import type { DataStore } from '../expr/data-store';
import type { TemplateEnv } from '../env';
import { ShapeTemplate } from './shape-template';
import { TextInfo } from './template-data';

export const TEXT_TEMPLATE_ID = 'avabodh.basic.text';

export class TextTemplate extends ShapeTemplate {
  constructor(env: TemplateEnv) {
    super(env);
    this.templateId = TEXT_TEMPLATE_ID;
  }

  override load(): void {
    if (this.textData.length === 0) {
      const ti = new TextInfo();
      ti.location = 'default';
      ti.style = new Style();
      this.textData.push(ti);
    }
    super.load();
  }

  override clone(): TextTemplate {
    const tmpl = new TextTemplate(this.env_);
    this.copy(tmpl);
    return tmpl;
  }

  /**
   * Only the box: the text's unconstrained size plus `textObjectBoundsAdjust`. As C++, the data
   * expressions are not evaluated here.
   */
  override generateData(ds: DataStore): void {
    const te = this.texts_[0];
    if (te === undefined) return;
    te.setFloating(true);
    const style = te.style();
    if (style === null) return;
    const actual = this.env_.text.measure(te.text(), style, new Size(-1, -1));
    const adjust = this.env_.config.textObjectBoundsAdjust;
    ds.setWidth(actual.width + adjust);
    ds.setHeight(actual.height + adjust);
  }
}
