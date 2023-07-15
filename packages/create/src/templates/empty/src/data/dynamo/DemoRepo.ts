import { RepositoryExtended } from "@lambada/utils";
import { tables } from "../tables";
import { DemoData, IDemoRepo } from "../../lib/IDemoRepo";

export class DemoRepo extends RepositoryExtended implements IDemoRepo {
    constructor() {
        super(tables["test-table"])
    }
    getByUserId(userId: string): Promise<DemoData[]> {
        return super.query({
            name: 'userId',
            value: userId
        })
    }
}