import { ConfigureAwsEnvironment } from '@lambada/core'
import AWS from 'aws-sdk';
import { tables } from './src/data/tables';
import { localAWS } from './lambada.config';


module.exports = async () => {
    await ConfigureAwsEnvironment({
        options: localAWS
    }, {
        tables: tables
    });
};
