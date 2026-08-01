export namespace main {
	
	export class DocumentSpec {
	    id: string;
	    name: string;
	    width: number;
	    height: number;
	    unit: string;
	    physicalWidth: number;
	    physicalHeight: number;
	    resolutionDpi: number;
	    colorSpace: string;
	    background: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new DocumentSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.unit = source["unit"];
	        this.physicalWidth = source["physicalWidth"];
	        this.physicalHeight = source["physicalHeight"];
	        this.resolutionDpi = source["resolutionDpi"];
	        this.colorSpace = source["colorSpace"];
	        this.background = source["background"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class EditorStatus {
	    appName: string;
	    engine: string;
	    documentOpen: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditorStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.appName = source["appName"];
	        this.engine = source["engine"];
	        this.documentOpen = source["documentOpen"];
	    }
	}
	export class ImportedImage {
	    id: string;
	    name: string;
	    width: number;
	    height: number;
	    mimeType: string;
		    sourceUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportedImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.mimeType = source["mimeType"];
		        this.sourceUrl = source["sourceUrl"];
	    }
	}

}
