import * as AWS from "aws-sdk";
import { AttributeValue, AttributeMap } from 'aws-sdk/clients/dynamodb';

export interface IMarshaller {
    marshallItem(item: {
        [key: string]: any;
    }): AttributeMap;

    marshallValue(value: any): AttributeValue | undefined;
    unmarshallItem(item: AttributeMap): any;

    unmarshallValue(item: AttributeValue): any;
}

export const DefaultMarshaller: IMarshaller = {
    marshallItem: AWS.DynamoDB.Converter.marshall,
    unmarshallItem: AWS.DynamoDB.Converter.unmarshall,
    marshallValue: AWS.DynamoDB.Converter.input,
    unmarshallValue: AWS.DynamoDB.Converter.output,
};
