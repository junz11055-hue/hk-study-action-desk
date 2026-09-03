/**
 * Evaluation-only integrity manifest for the frozen Phase 2 development set.
 * These digests must only change through an explicit, reviewed truth refresh.
 */
import { ACTIVE_AI_OUTPUT_CONTRACT } from "../contracts/ai-output-contract-manifest.js";

export const PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION =
  "phase2-development-evaluation-truth-manifest-v1";

export const PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION =
  ACTIVE_AI_OUTPUT_CONTRACT.schema_version;
export const PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH =
  ACTIVE_AI_OUTPUT_CONTRACT.canonical_schema_hash;

export const PHASE2_EVALUATION_SOURCE_FILE_HASH =
  "sha256:e51e65148e297cfbe1675314f693f3bd019169a8d7594582664b16692f576f0d";

export const PHASE2_EVALUATION_TRUTH_MANIFEST_HASH =
  "sha256:7e7f755579c2e35457c39ee1dffb4647a4f579e5e010e6a0c0960f49d369d98e";

export const PHASE2_EVALUATION_TRUTH_ENTRIES = Object.freeze([
  Object.freeze({
    caseId: "DEV001",
    modelInputHash:
      "sha256:707712b74bf7c631554179fd949ed0892987b89bba543e483f71258a7b0cbc82",
    expectedHash:
      "sha256:3850670592ae8d57df6afdc25c0a0e8bfea623ff0e617e84deb92c80e1b7dba9",
    oracleHash:
      "sha256:483e2755973c3f488eba3c3d7499e33871eb4e4e259c4473bb590675f3535bfd",
    referenceCandidateHash:
      "sha256:f4de11e0930fa3ff2bb30d4a7dc5b6eccb7184a83759c2908e849cf20df78c35",
  }),
  Object.freeze({
    caseId: "DEV003",
    modelInputHash:
      "sha256:2a03da1fa08c00677042b7c7603666dd040b0ec88eb5e3544b1857522c577f0e",
    expectedHash:
      "sha256:f7af3cf2ca3ec912ba3adb2c6b681f9ada6d3ad599685184e1df25c80208aac7",
    oracleHash:
      "sha256:13ac68449a8a66017abc799b83b445adcef7d499d298b38930f5dfa2048a6693",
    referenceCandidateHash:
      "sha256:22792f3f15b61a3296135b9ec9c5ea78543fb2b468382a063b3573b2c94a3800",
  }),
  Object.freeze({
    caseId: "DEV004",
    modelInputHash:
      "sha256:53a1c9e466787b7e65f06acdbebc9d3dede1b02fdd82e60c4f018c8a4323af46",
    expectedHash:
      "sha256:59c28a39d00c9dbb6074e115ca3a5dc3eb75b3c50983190e51844d4ec29330d5",
    oracleHash:
      "sha256:f0a9d83537e9a059688c6d5aa0a46bc0fd37d0f084b60bd276c3d68dbd230f5c",
    referenceCandidateHash:
      "sha256:d559b062d1cc1c24c8b8ac75d8fee222b361b698707dbff10aaca10eb55e444a",
  }),
  Object.freeze({
    caseId: "DEV005",
    modelInputHash:
      "sha256:6ce36323ede19e5246538454ccda781a5a8fb742adc9e6caab2257dc8686dd07",
    expectedHash:
      "sha256:574ac4dceacaaa0b360bf07ff98623280eed763e594969d32aae90ee6b2fd110",
    oracleHash:
      "sha256:7b51da6d3134224571e05304a582e51aef6b6daf560a404be679f5960b3bb61b",
    referenceCandidateHash:
      "sha256:fb7dd0fc76f9a1b7d8d5d20d09c8005f805e246b7d9eee459c03f5be20ebc5b2",
  }),
  Object.freeze({
    caseId: "DEV006",
    modelInputHash:
      "sha256:c6fb058e5a54cf30304fc8c9a6c06b0193a27a2211ca6a09c30353844ce0504a",
    expectedHash:
      "sha256:4605a461251b9ae294533d644b0ed4f8fb50d0adbd964e6f540b75e398bbdca9",
    oracleHash:
      "sha256:df1e46e720e1001829e9bfbc69650adf70f801213fbb5217b2438b414236c01b",
    referenceCandidateHash:
      "sha256:0910385c09b60cd19b9fe273400febdbd7098864e024d77625d2aca5a5e93e32",
  }),
  Object.freeze({
    caseId: "DEV007",
    modelInputHash:
      "sha256:5cc67a38495bc15e8b6ab8999a3c956c29c46ec85cba6d0883e976cc34b51036",
    expectedHash:
      "sha256:f3f5185101fc128e44b09cd381c7b505d02682e5aaf3bd3fb5ee365e8d1288ea",
    oracleHash:
      "sha256:af88dfd40d9be36fedf52fe21d38a9b624878a4a0c25ae463dbfd116fb396d78",
    referenceCandidateHash:
      "sha256:9b6f831157356337359e13d8fe61670e923c17273a44610b0eb1fcfc8656e0a1",
  }),
  Object.freeze({
    caseId: "DEV008",
    modelInputHash:
      "sha256:240923be8ef46a50756853f50570ff842356c6e3a65153d94c6f1fc7e266698a",
    expectedHash:
      "sha256:d39d789b71a49991c3ec467481660237f38bed0346495f86c021b9eb19c40c94",
    oracleHash:
      "sha256:bba5d0e7c4d9146dc879f84e49079a69044705412e437974046e06db873fb41f",
    referenceCandidateHash:
      "sha256:a9e076376a913f86a2893305cf28398f8e288c66d5d9c5fc9a1002ae722b7cad",
  }),
  Object.freeze({
    caseId: "DEV010",
    modelInputHash:
      "sha256:70662fbcdca6e9cc595b618f9726aa2aeef512afc179af3c8737d53424cba7e4",
    expectedHash:
      "sha256:d877f787b07c7cfd01c71543563fdc404cde26954764b683099e90dc3af846bf",
    oracleHash:
      "sha256:36a83f55add087e4cf5185d8183fbc57ef04d31ba030e887282f9e1a13bab1f4",
    referenceCandidateHash:
      "sha256:4cbe427030d2af4f0dd0870d1650eb76bd46868871c025c39df8884cfe6c6fd7",
  }),
  Object.freeze({
    caseId: "DEV017",
    modelInputHash:
      "sha256:e816747ca3ad5acedc98912a9b45136affb6e1fc25b83abebda494aa44b92b42",
    expectedHash:
      "sha256:9c837d3cd7368bdc6dc6f6b240959582db94c8b69d6e45ec5e3adf0d1a17200b",
    oracleHash:
      "sha256:0aa3f9c8586bf992d50e100886ec5957b1b1c123bb266b8971b0bfbed1f8b947",
    referenceCandidateHash:
      "sha256:40a4b0d674cdf737bbf40720798d265e931ede46d176171e76100829fd4cc877",
  }),
  Object.freeze({
    caseId: "DEV018",
    modelInputHash:
      "sha256:8f3e7daff2fe62d445ebdc8bb645aa51df9c5c30520d5fa1873fc71ffa86e6f2",
    expectedHash:
      "sha256:56a2110a0ca8b893f2ebbb65eddd3f78ce957b6d342cb781539892fb16ef8879",
    oracleHash:
      "sha256:90cabd0b22653ccc87b8895af1eb3b9d58daa47edcd4dda1bdc6c41eebd59454",
    referenceCandidateHash:
      "sha256:74344a8b6a7d9cdc3535fb2e5b8a96938884caeb5ed4b27417deca4e5a816d18",
  }),
  Object.freeze({
    caseId: "DEV019",
    modelInputHash:
      "sha256:08a0d8eb603f187e79ee37d32e4f86e8e07431069c3b519cae767911a69a8aea",
    expectedHash:
      "sha256:7cdd82f7e4caa68aead960cf873e0b65197abd7e576c1177e3f42a8a376c4a41",
    oracleHash:
      "sha256:fcfc43d788321da6cf1871cd072b402db2ac5ee9aaae00e9ce545534ea658185",
    referenceCandidateHash:
      "sha256:2c0a47efca123868a7db92857d4b0feaca3fb485b68cc1dd0cb28a145805f11a",
  }),
  Object.freeze({
    caseId: "DEV020",
    modelInputHash:
      "sha256:b4fccd4a1d9acedcd4fd99b5b8d714b3bc345a327e5cd20635cbff6b91d881e3",
    expectedHash:
      "sha256:0965629a328cfa7f86a257fafac20e89dbe8520b2bcf6bef5b782dceb5e0e7b5",
    oracleHash:
      "sha256:123b6cd0d68e2785c78575c26686a14e9d0f6de6306081fcd12c96c402417986",
    referenceCandidateHash:
      "sha256:1198ddd175af42fbe27adfcde54f2bb8c3d1a342b335a299369ee759d9913685",
  }),
  Object.freeze({
    caseId: "DEV022",
    modelInputHash:
      "sha256:6c1fd60453f794f9496040a8c4b5c0ff62e4fff14eace73661d9973e08fb1159",
    expectedHash:
      "sha256:b963fc648e887059c54f303cbc45daab99e3331fad2e27c3152ca582e1e515f8",
    oracleHash:
      "sha256:9154b084eb4b8c9042d0456ed3d35b708df4b2e94cae53bd874838c58cbbd3d0",
    referenceCandidateHash:
      "sha256:675b6f0fec09f788badfe3758cc4a5194bbc4321e4e801eaf6988dd91bccf5a7",
  }),
  Object.freeze({
    caseId: "DEV023",
    modelInputHash:
      "sha256:5d3dd991bf3fced656a7aa4cc365d678c099844345e422c6a41059a20e6bcf0c",
    expectedHash:
      "sha256:f75174ca3ca93e053c25c334cd4114ba566e675c1d4cadb43437d8b83bac8181",
    oracleHash:
      "sha256:19489e65a8733dee6ab67705a80f45ac5b4302af80c06da79e13dbbfee9a63d0",
    referenceCandidateHash:
      "sha256:15ccae85215c98eb45d6e2749e0943e84a4a2db1f0c2dbbaf817e03bb47e24be",
  }),
  Object.freeze({
    caseId: "DEV024",
    modelInputHash:
      "sha256:162f538c55a78d05bdf6348eb87c047434e9e46ed0a3e339f2aa164fc051f881",
    expectedHash:
      "sha256:1e2e68dbcc45d821db7606fbe236833f6236cba302cd541eeb409698db9f4967",
    oracleHash:
      "sha256:0460eb9140420a7bbc5bc8633b10e3a949b8374b689fc4d40f8b3c4928af8aab",
    referenceCandidateHash:
      "sha256:82caa0c804d5bff9bd83d56a4c9140f74eca57fd697300025fc42868d5585aa0",
  }),
  Object.freeze({
    caseId: "DEV025",
    modelInputHash:
      "sha256:9f51599cce92c0b8d3011942f0f19a7f2d20b6cd8a4e0413c0fc86d4c4a28a59",
    expectedHash:
      "sha256:035bf7013cf1807e90e0da985ac30f05183b6891665dfef708cc950697a6e9e5",
    oracleHash:
      "sha256:aab17a8599e81b6e3ce09b8df52c8442761fc386a59e803c73734fd5070d55e6",
    referenceCandidateHash:
      "sha256:8f1ac403350c92c35aa3de88ac908768fe1629444edbd5ce5a4075e472985809",
  }),
]);
