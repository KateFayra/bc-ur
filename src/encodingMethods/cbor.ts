 const cbor = require('cbor-web')
 import isBuffer = require("is-buffer");

export const cborEncode = (data: any): Buffer => {
  return cbor.encode(data);
};

export const cborDecode = (data: string | Buffer): any => {
  return cbor.decode(isBuffer(data) ? data : Buffer.from(data as string, 'hex'));
}

