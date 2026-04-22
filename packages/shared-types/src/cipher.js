// 凭据条目相关类型
export var CipherType;
(function (CipherType) {
    CipherType[CipherType["LOGIN"] = 1] = "LOGIN";
    CipherType[CipherType["CARD"] = 2] = "CARD";
    CipherType[CipherType["IDENTITY"] = 3] = "IDENTITY";
    CipherType[CipherType["SECURE_NOTE"] = 4] = "SECURE_NOTE";
    CipherType[CipherType["PASSKEY"] = 5] = "PASSKEY";
})(CipherType || (CipherType = {}));
export var UriMatchType;
(function (UriMatchType) {
    UriMatchType[UriMatchType["DOMAIN"] = 0] = "DOMAIN";
    UriMatchType[UriMatchType["HOST"] = 1] = "HOST";
    UriMatchType[UriMatchType["STARTS_WITH"] = 2] = "STARTS_WITH";
    UriMatchType[UriMatchType["EXACT"] = 3] = "EXACT";
    UriMatchType[UriMatchType["REGULAR_EXPRESSION"] = 4] = "REGULAR_EXPRESSION";
    UriMatchType[UriMatchType["NEVER"] = 5] = "NEVER";
})(UriMatchType || (UriMatchType = {}));
export var RepromptType;
(function (RepromptType) {
    RepromptType[RepromptType["NONE"] = 0] = "NONE";
    RepromptType[RepromptType["PASSWORD"] = 1] = "PASSWORD";
})(RepromptType || (RepromptType = {}));
export var FieldType;
(function (FieldType) {
    FieldType[FieldType["TEXT"] = 0] = "TEXT";
    FieldType[FieldType["HIDDEN"] = 1] = "HIDDEN";
    FieldType[FieldType["BOOLEAN"] = 2] = "BOOLEAN";
})(FieldType || (FieldType = {}));
