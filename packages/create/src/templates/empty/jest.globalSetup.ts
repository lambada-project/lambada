import { ConfigureAwsEnvironment } from '@lambada/core'
import { tables } from './src/data/tables';
import { localAWS } from './lambada.config';


module.exports = async () => {
    await ConfigureAwsEnvironment({
        options: localAWS
    }, {
        tables: tables
    });
};
