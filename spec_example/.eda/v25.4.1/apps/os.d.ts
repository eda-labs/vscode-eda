/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */

export interface paths {
    "/apps/os.eda.nokia.com": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description list versions available from os.eda.nokia.com */
        get: operations["getVersionOsEdaNokiaCom"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description list resources available from os.eda.nokia.com/v1alpha1 */
        get: operations["getResourcesOsEdaNokiaComV1alpha1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/_ui/{pathname}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description get UI specification for os.eda.nokia.com v1alpha1 */
        get: operations["uiOsEdaNokiaComV1alpha1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/deployimages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description list deployimages */
        get: operations["listOsEdaNokiaComV1alpha1Deployimages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/namespaces/{namespace}/deployimages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description list deployimages in namespace */
        get: operations["listOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        put?: never;
        /** @description create a DeployImage */
        post: operations["createOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        /** Delete all instances of DeployImage in the specified namespace. */
        delete: operations["deleteAllOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/namespaces/{namespace}/deployimages/_deleted": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get information about the instances of DeployImage that have been deleted that existed in the specified namespace. */
        get: operations["getDeletedOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/namespaces/{namespace}/deployimages/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description read the specified DeployImage.  If a git hash query parameter
         *     is supplied, the resource as it existed at the time of the git hash
         *     will be returned. Streaming is not supported when a particular revision
         *     is asked for. */
        get: operations["readOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        /** @description replace a DeployImage */
        put: operations["replaceOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        post?: never;
        /** @description delete the specified DeployImage */
        delete: operations["deleteOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        options?: never;
        head?: never;
        /** @description patch a DeployImage */
        patch: operations["patchOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        trace?: never;
    };
    "/apps/os.eda.nokia.com/v1alpha1/namespaces/{namespace}/deployimages/{name}/_revs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get revision history for the specified namespaced DeployImage. */
        get: operations["getHistoryOsEdaNokiaComV1alpha1NamespaceDeployimages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AppGroup: {
            apiVersion?: string;
            kind?: string;
            name?: string;
            preferredVersion?: components["schemas"]["AppGroupVersion"];
            versions?: components["schemas"]["AppGroupVersion"][];
        };
        AppGroupVersion: {
            groupVersion?: string;
            version?: string;
        };
        /** Wrapper for index information inside an error. */
        ErrorIndex: {
            /** Format: int64 */
            index?: number;
        };
        ErrorItem: {
            error?: Record<string, never>;
            type?: string;
        };
        /** @description Generic error response for REST APIs */
        ErrorResponse: {
            /**
             * Format: int64
             * @description the numeric HTTP error code for the response.
             */
            code: number;
            /** @description The optional details of the error response. */
            details?: string;
            /** @description Dictionary/map of associated data/information relevant to the error.
             *     The error "message" may contain {{name}} escapes that should be substituted
             *     with information from this dictionary. */
            dictionary?: {
                [key: string]: unknown;
            };
            /** @description Collection of errors in cases where more than one exists. This needs to be
             *     flexible so we can support multiple formats */
            errors?: components["schemas"]["ErrorItem"][];
            index?: components["schemas"]["ErrorIndex"];
            /**
             * Format: int64
             * @description Internal error code in cases where we don't have an array of errors
             */
            internal?: number;
            /** @description The basic text error message for the error response. */
            message: string;
            /** @description Reference to the error source. Should typically be the URI of the request */
            ref?: string;
            /** @description URI pointing at a document that describes the error and mitigation steps
             *     If there is no document, point to the RFC for the HTTP error code */
            type?: string;
        };
        K8SPatchOp: {
            from?: string;
            op: string;
            path: string;
            value?: Record<string, never>;
            "x-permissive"?: boolean;
        };
        Patch: components["schemas"]["K8SPatchOp"][];
        Resource: {
            kind?: string;
            name?: string;
            namespaced?: boolean;
            readOnly?: boolean;
            singularName?: string;
            uiCategory?: string;
        };
        ResourceHistory: components["schemas"]["ResourceHistoryEntry"][];
        ResourceHistoryEntry: {
            author?: string;
            changeType?: string;
            commitTime?: string;
            hash?: string;
            message?: string;
            /** Format: uint64 */
            transactionId?: number;
        };
        ResourceList: {
            apiVersion?: string;
            groupVersion?: string;
            kind?: string;
            resources?: components["schemas"]["Resource"][];
        };
        /** Status is a return value for calls that don't return other objects. */
        Status: {
            apiVersion?: string;
            details?: components["schemas"]["StatusDetails"];
            kind?: string;
            string?: string;
        };
        StatusDetails: {
            group?: string;
            kind?: string;
            name?: string;
        };
        UIResult: string;
        /** @description DeployImage is the Schema for the deployimages API */
        "com.nokia.eda.os.v1alpha1.DeployImage": {
            /** @default os.eda.nokia.com/v1alpha1 */
            apiVersion: string;
            /** @default DeployImage */
            kind: string;
            metadata: components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage_metadata"];
            /**
             * Specification
             * @description DeployImageSpec defines the desired state of DeployImage
             */
            spec: {
                /** canaries */
                canaries?: string[];
                /** checks */
                checks?: {
                    /**
                     * checks
                     * @description Checks to run before (pre) and after (post) any image changes
                     * @enum {array}
                     */
                    checks: "Interface" | "DefaultBGP" | "PingISL" | "PingSystem";
                    /** @description Do not prompt for user input, even if checks fail */
                    force: boolean;
                    /** @description Do not run any checks */
                    skip: boolean;
                };
                /** drains */
                drains?: {
                    /** InterfaceDisableSelectors */
                    interfaceDisableSelectors?: string[];
                    /** minimumWaitTime */
                    minimumWaitTime?: number;
                    /**
                     * skip
                     * @description Do not run any drains
                     */
                    skip?: boolean;
                };
                /** nodeProfile */
                nodeProfile?: string;
                /** nodeSelector */
                nodeSelector?: string[];
                /** nodes */
                nodes?: string[];
                /**
                 * prompt
                 * @enum {array}
                 */
                prompt?: "AfterPreChecks" | "AfterPostChecks";
                /** tranches */
                tranches?: {
                    /** name */
                    name?: string;
                    /** nodeSelector */
                    nodeSelector?: string[];
                }[];
                /**
                 * type
                 * @enum {string}
                 */
                type: "node" | "nodeselector" | "tranche";
                /** version */
                version?: string;
            };
            /**
             * Status
             * @description DeployImageStatus defines the observed state of DeployImage
             */
            readonly status?: {
                /**
                 * ID
                 * @description Id
                 */
                id?: number;
                /**
                 * Result
                 * @description Aggregate result of the Flow
                 */
                result?: string;
            };
        };
        /** @description DeployImageList is a list of deployimages */
        "com.nokia.eda.os.v1alpha1.DeployImageList": {
            apiVersion: string;
            items?: components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"][];
            kind: string;
        };
        "com.nokia.eda.os.v1alpha1.DeployImage_DeletedResourceEntry": {
            commitTime?: string;
            hash?: string;
            name?: string;
            namespace?: string;
            /** Format: uint64 */
            transactionId?: number;
        };
        "com.nokia.eda.os.v1alpha1.DeployImage_DeletedResources": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage_DeletedResourceEntry"][];
        "com.nokia.eda.os.v1alpha1.DeployImage_metadata": {
            annotations?: {
                [key: string]: string;
            };
            labels?: {
                [key: string]: string;
            };
            name: string;
            namespace: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getVersionOsEdaNokiaCom: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppGroup"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getResourcesOsEdaNokiaComV1alpha1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceList"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    uiOsEdaNokiaComV1alpha1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description pathname to the UI specification to retrieve */
                pathname: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UIResult"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listOsEdaNokiaComV1alpha1Deployimages: {
        parameters: {
            query?: {
                /** @description a label selector string to filter the results based on CR labels */
                "label-selector"?: string;
                /** @description client information for streaming request */
                eventclient?: string;
                /** @description stream information for streaming request */
                stream?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImageList"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: {
                /** @description a label selector string to filter the results based on CR labels */
                "label-selector"?: string;
                /** @description client information for streaming request */
                eventclient?: string;
                /** @description stream information for streaming request */
                stream?: string;
            };
            header?: never;
            path: {
                /** @description the namespace scope from which to retrieve the result */
                namespace: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImageList"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                namespace: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteAllOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: {
                /** @description a label selector string to filter the set of CRs deleted based on CR labels */
                "label-selector"?: string;
            };
            header?: never;
            path: {
                /** @description the namespace scope from which to perform the delete */
                namespace: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImageList"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getDeletedOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description the namespace scope from which to retrieve the result */
                namespace: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Returns list of deleted resource entries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage_DeletedResources"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: {
                /** @description a label selector string to filter the results based on CR labels */
                "label-selector"?: string;
                /** @description client information for streaming request */
                eventclient?: string;
                /** @description stream information for streaming request */
                stream?: string;
                /** @description resource content will be returned as it was at the time of this git hash */
                hash?: string;
            };
            header?: never;
            path: {
                /** @description the namespace scope from which to retrieve the result */
                namespace: string;
                /** @description name of the DeployImage to retrieve */
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    replaceOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                namespace: string;
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description the namespace scope from which to perform the delete */
                namespace: string;
                /** @description name of the DeployImage to delete */
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    patchOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                namespace: string;
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Patch"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["com.nokia.eda.os.v1alpha1.DeployImage"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getHistoryOsEdaNokiaComV1alpha1NamespaceDeployimages: {
        parameters: {
            query?: {
                /** @description client information for streaming request */
                eventclient?: string;
                /** @description stream information for streaming request */
                stream?: string;
                /** @description maximum number of history entries to return */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description name of the DeployImage to retrieve */
                name: string;
                /** @description the namespace scope from which to retrieve the result */
                namespace: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Returns the change history of the specified resource */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResourceHistory"];
                };
            };
            /** @description Details of an error in response to an API REST request. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
