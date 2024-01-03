import { AttributeValue } from "@aws-sdk/client-dynamodb";
import * as Converter from "@aws-sdk/util-dynamodb"
export type AttributeMap = Record<string, AttributeValue>
export interface IMarshaller {
    marshallItem(item: {
        [key: string]: any;
    }): AttributeMap;

    marshallValue(value: any): AttributeValue | undefined;
    unmarshallItem(item: AttributeMap): unknown;

    unmarshallValue(item: AttributeValue): unknown;
}

export const DefaultMarshaller: IMarshaller = {
    marshallItem: Converter.marshall,
    unmarshallItem: Converter.unmarshall,
    marshallValue: Converter.convertToAttr,
    unmarshallValue: Converter.convertToNative,
};
