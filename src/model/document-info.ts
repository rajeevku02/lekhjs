// The document's `info` block (port of C++ `MetaInfo`, `Platform.{h,cpp}`; spec 02 canonical name
// `DocumentInfo`). The defaults are the C++ constructor's; `version` is the format version read
// or to be written (the writer's stamp policy decides it, spec 03 §10.6).
export class DocumentInfo {
  version = '1.0';
  createdOnPlatform = '1';
  compatibilityList = '1.0';
  title = 'Lekh Diagram';
  description = 'Diagram created using Lekh Diagram';
  author = '';

  clone(): DocumentInfo {
    const d = new DocumentInfo();
    d.version = this.version;
    d.createdOnPlatform = this.createdOnPlatform;
    d.compatibilityList = this.compatibilityList;
    d.title = this.title;
    d.description = this.description;
    d.author = this.author;
    return d;
  }
}
