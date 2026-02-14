import * as AjvModule from 'ajv/dist/ajv.js';
import type AjvType from 'ajv/dist/ajv.js';

const AjvDefault = (
  (AjvModule as { default?: unknown }).default
  ?? (AjvModule as { Ajv?: unknown }).Ajv
  ?? AjvModule
) as typeof AjvType;

export default AjvDefault;
