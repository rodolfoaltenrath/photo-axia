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
	export class ImportedImage {
	    id: string;
	    name: string;
	    width: number;
	    height: number;
	    mimeType: string;
	    sourceUrl: string;
	    byteSize?: number;
	    resolutionDpiX?: number;
	    resolutionDpiY?: number;
	    resolutionSource?: string;
	
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
	        this.byteSize = source["byteSize"];
	        this.resolutionDpiX = source["resolutionDpiX"];
	        this.resolutionDpiY = source["resolutionDpiY"];
	        this.resolutionSource = source["resolutionSource"];
	    }
	}
	export class DroppedFilesResult {
	    images: ImportedImage[];
	    errors: string[];
	
	    static createFrom(source: any = {}) {
	        return new DroppedFilesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.images = this.convertValues(source["images"], ImportedImage);
	        this.errors = source["errors"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
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
	export class ExportSaveTarget {
	    token: string;
	    path: string;

	    static createFrom(source: any = {}) {
	        return new ExportSaveTarget(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.path = source["path"];
	    }
	}
	
	export class OpenedAxiaProject {
	    path: string;
	    manifest: string;
	    assetUrls: Record<string, string>;
	    sessionId: string;
	
	    static createFrom(source: any = {}) {
	        return new OpenedAxiaProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.manifest = source["manifest"];
	        this.assetUrls = source["assetUrls"];
	        this.sessionId = source["sessionId"];
	    }
	}
	export class ProjectSaveTarget {
	    token: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectSaveTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.path = source["path"];
	    }
	}
	export class RecentProject {
	    id: string;
	    path: string;
	    name: string;
	    width: number;
	    height: number;
	    modifiedAt: string;
	    lastOpenedAt: string;
	    thumbnailUrl: string;
	    thumbnailVersion: number;
	    available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RecentProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.modifiedAt = source["modifiedAt"];
	        this.lastOpenedAt = source["lastOpenedAt"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.thumbnailVersion = source["thumbnailVersion"];
	        this.available = source["available"];
	    }
	}

}
