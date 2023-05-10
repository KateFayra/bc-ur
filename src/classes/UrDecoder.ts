import { Decoder, IDecoder } from "./Decoder";
import { MultipartUr } from "./MultipartUr";
import { Ur } from "./Ur";
import { IEncodingMethod } from "../interfaces/IEncodingMethod";
import assert from "assert";
import { RegistryType } from "../interfaces/RegistryType";
import { getCRC } from "../utils";
import { InvalidChecksumError } from "../errors";
import isBuffer = require("is-buffer");

export type MultipartPayload = {
  seqNum: number;
  seqLength: number;
  messageLength: number;
  checksum: number;
  fragment: Buffer;
};

export class UrDecoder<T, U>
  extends Decoder<string, U>
  implements IDecoder<string, U>
{
  constructor(encodingMethods: IEncodingMethod<any, any>[]) {
    super(encodingMethods);
  }

  decodeCbor(payload: Buffer): U {
    return this.encodingMethods[this.encodingMethods.length - 1].decode(
      payload
    );
  }

  /**
   * Decode single fragment into the original Ur.
   * @param fragment stringified Ur
   * @returns original encoded Ur.
   */
  decodeFragment(fragment: string): Ur<T> {
    const { registryType, payload } = Ur.parseUr(fragment);
    const { type } = registryType;
    const decoded = super.decode<T>(payload);

    return new Ur(decoded, { type });
  }

  /**
   * Decode multipart fragments into the original Ur.
   * Take into account that in order to use this function, the fragments should be in the correct order (ordered by seqNum, ascending).
   * Otherwise you can sort them yourself, or use the fountainDecoder.
   * @param fragments array of stringified Ur's, in the correct order.
   * @returns original encoded Ur.
   */
  decodeFragments(fragments: string[]): Ur<U> {
    let expectedRegistryType = null;
    let expectedPayload: {
      indexes: number[];
      messageLength: number;
      checksum: number;
      fragmentLength: number;
    } = null;

    const fragmentPayloads: Buffer[] = fragments.map((fragment) => {
      const multipart = this.decodeMultipartUr(fragment);
      const validatedPayload = this.validateMultipartPayload(multipart.payload);

      // set expected registryType if it does not exist
      if (!expectedRegistryType && Ur.isURType(multipart?.registryType?.type)) {
        expectedRegistryType = multipart.registryType;
      }

      // set expected payload if it does not exist
      if (!expectedPayload) {
        expectedPayload = {
          indexes: new Array(validatedPayload.seqLength)
            .fill(0)
            .map((_, i) => i),
          messageLength: validatedPayload.messageLength,
          checksum: validatedPayload.checksum,
          fragmentLength: validatedPayload.fragment.length,
        };
      }

      // compare expected type with the received the fragment
      if (
        expectedRegistryType &&
        !this.compareRegistryType(expectedRegistryType, multipart.registryType)
      ) {
        console.warn("Did not expect this ur type");
        // return default value.
        return Buffer.from([]);
      }

      // compare expected payload with the received fragment
      if (
        expectedPayload &&
        !this.compareMultipartUrPayload(expectedPayload, validatedPayload)
      ) {
        console.warn("Did not expect this payload");
        // return default value.
        return Buffer.from([]);
      }
      return validatedPayload.fragment;
    });

    // concat all the buffer payloads to a single buffer
    const cborPayload = this.joinFragments(
      fragmentPayloads,
      expectedPayload.messageLength
    );

    const checksum = getCRC(cborPayload);

    if (checksum === expectedPayload.checksum) {
      // decode the buffer as a whole.
      const decoded = this.decodeCbor(cborPayload);

      // convert to ur object
      return Ur.toUr(decoded, { ...expectedRegistryType });
    } else {
      throw new InvalidChecksumError();
    }
  }

  /**
   * Join the fragments together.
   * @param fragments fragments to join
   * @param messageLength length of the expected message.
   * @returns the concatenated fragments with the expected length.
   */
  protected joinFragments = (
    fragments: Buffer[],
    messageLength: number
  ): Buffer => {
    // with 'slice', we remove the additionally created buffer parts, needed to achieve the minimum fragment length.
    return Buffer.concat(fragments).slice(0, messageLength);
  };

  private compareMultipartUrPayload(
    expected: {
      indexes: number[];
      messageLength: number;
      checksum: number;
      fragmentLength: number;
    },
    decodedPart: MultipartPayload
  ): boolean {
    // If this part's values don't match the first part's values, throw away the part
    if (expected.indexes.length !== decodedPart.seqLength) {
      return false;
    }
    if (expected.messageLength !== decodedPart.messageLength) {
      return false;
    }
    if (expected.checksum !== decodedPart.checksum) {
      return false;
    }
    if (expected.fragmentLength !== decodedPart.fragment.length) {
      return false;
    }
    // This part should be processed
    return true;
  }

  /**
   * Create a decoded, multipart Ur from an encoded ur string.
   * @param payload
   * @returns
   */
  decodeMultipartUr(payload: string): MultipartUr<Buffer> {
    const {
      payload: bytewords,
      registryType,
      seqNum,
      seqLength,
    } = MultipartUr.parseUr(payload);

    const decoded = this.decode<Buffer>(bytewords); // {"_checksum": 556878893, "_fragment": [Object] (type of Buffer), "_messageLength": 2001, "_seqLength": 23, "_seqNum": 6}

    return MultipartUr.toMultipartUr<Buffer>(
      decoded,
      registryType,
      seqNum,
      seqLength
    );
  }

  public validateMultipartPayload(decoded: Buffer): MultipartPayload {
    const [seqNum, seqLength, messageLength, checksum, fragment] = decoded;

    assert(typeof seqNum === "number");
    assert(typeof seqLength === "number");
    assert(typeof messageLength === "number");
    assert(typeof checksum === "number");
    assert(isBuffer(fragment) && (fragment as unknown as Buffer).length > 0);
    const validatedFragment = fragment as unknown as Buffer;
    return {
      seqNum,
      seqLength,
      messageLength,
      checksum,
      fragment: validatedFragment,
    };
  }

  /**
   * validates the type of the UR part
   * @param registryType type of the UR part (e.g. "bytes")
   * @returns true if the type is valid and matches the expected type
   */
  private compareRegistryType(
    expectedRegistryType: RegistryType,
    registryType: RegistryType
  ): boolean {
    const { type: expectedType } = expectedRegistryType;
    const { type } = registryType;

    return expectedType === type;
  }
}
