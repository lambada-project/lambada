export interface IDemoRepo {
    getByUserId(userId: string): Promise<DemoData[]>
}

export type DemoData = {
    userId: string
    id: string
}