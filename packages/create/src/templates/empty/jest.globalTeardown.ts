import { RemoveResources } from '@lambada/core'
import { tables } from './src/data/tables';

module.exports = async () => {
    await RemoveResources(tables)
};
