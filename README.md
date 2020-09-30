# Lambda workers (js & python) executed using WASM engine

Run lambda tasks inside a web assembly engine [wasmer](https://wasmer.io/).
Every execution spawns a new short lived process.

## Running locally
Install [wapm](https://wapm.io), then install packages
[python](https://wapm.io/package/python) and [quickjs](https://wapm.io/package/quickjs).
Run:
```sh
WASMER_PATH=~/.wasmer/wasmer \
QUICKJS_PATH=~/.wasmer/globals/wapm_packages/_/quickjs@0.0.3/build/qjs.wasm \
CONDUCTOR_URL=http://localhost:8089/api \
PYTHON_PATH=~/.wasmer/globals/wapm_packages/_/python@0.1.0/bin/python.wasm \
PYTHON_LIB_PATH=~/.wasmer/globals/wapm_packages/_/python@0.1.0/lib/ \
yarn start:dev
```

## Usage

Currently supports two task types: `GLOBAL___js` and `GLOBAL___py`.

* `lambdaValue` - convention for storing task inputs. E.g. workflow input: `${workflow.input.enter_your_name}`,
result of previous task: `${some_task_ref.output.result}`
* `outputIsJson` - if set to `true`, output is interpreted as JSON and
task will be marked as failed if parsing fails. If `false`, output is interpreted as plaintext.
Any other value, including empty one, means output will be parsed as JSON, will fallback
to plaintext on parsing failure.
* `scriptExpression` - script to be executed

## Javascript engine
Task `GLOBAL___js` uses [QuickJs](https://bellard.org/quickjs/) engine, compiled to wasm [(demo)](https://wapm.io/package/quickjs).

### APIs
Task result is written using `print` (no newline is appended) or by `return`ing the value (preferred).

Log messages are written using `log` (preferred) or `console.error` or `console.log`. Newline is appended in any case.

Input data is available in `$` global variable.
Use `$.lambdaValue` to get task input.
This is backwards compatibile with
[Lambda tasks](https://netflix.github.io/conductor/configuration/systask/#lambda-task)

## Python interpreter
Task `GLOBAL___py` uses CPython 3.6 compiled to wasm [(demo)](https://wapm.io/package/python).

### APIs
Task result is written using `print` (adds newline) or by `return`ing the value (preferred).
It is possible to disable adding newline character using `print('msg',end='')` syntax.

Log messages are written using `log`.  Newline is appended in both cases.

Input data is available in `inputData` global variable.
Use `inputData["lambdaValue"]` to get task input.

## Example workflow

This example asks user for name, then executes:
* python task:
lambdaValue: `${workflow.input.enter_your_name}`
```python
log('logging from python')
name = inputData['lambdaValue']
return {'name': name}
```
* javascript task:
lambdaValue: `${create_json_ref.output.result}`
```javascript
log('logging from js');
var result = $.lambdaValue;
result.name_length = (result.name||'').length;
return result;
```

### Set CONDUCTOR_API variable (not used by wasm-worker)
Assuming tenant 'fb-test' and user 'fbuser' are set up in Keycloak,
use workflow-proxy
```shell script
CONDUCTOR_API="http://localhost:8088/proxy/api"
SECURITY_HEADERS=(-H "x-tenant-id: fb-test" -H "from: fbuser")
```
To bypass proxy and go directly to conductor-server,
```shell script
CONDUCTOR_API="http://localhost:8050/api"
SECURITY_HEADERS=()
```

### Create new workflow wasm-example
POST to `/metadata/workflow`

```shell script
curl -v \
  "${SECURITY_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  ${CONDUCTOR_API}/metadata/workflow -d @- << 'EOF'
{
    "name": "wasm-example",
    "description": "python and javascript lambdas running in wasm",
    "ownerEmail": "example@example.com",
    "version": 1,
    "schemaVersion": 2,
    "tasks": [
        {
            "taskReferenceName": "create_json_ref",
            "name": "GLOBAL___py",
            "inputParameters": {
                "lambdaValue": "${workflow.input.enter_your_name}",
                "outputIsJson": "true",
                "scriptExpression": "log('logging from python')\nname = inputData['lambdaValue']\nreturn {'name': name}\n"
            },
            "type": "SIMPLE",
            "startDelay": 0,
            "optional": false,
            "asyncComplete": false
        },
        {
            "taskReferenceName": "calculate_name_length_ref",
            "name": "GLOBAL___js",
            "inputParameters": {
                "lambdaValue": "${create_json_ref.output.result}",
                "outputIsJson": "true",
                "scriptExpression": "log('logging from js');\nvar result = $.lambdaValue;\nresult.name_length = (result.name||'').length;\nreturn result;\n"
            },
            "type": "SIMPLE",
            "startDelay": 0,
            "optional": false,
            "asyncComplete": false
        }
    ]
}
EOF
```

### Execute the workflow
POST to `/workflow`

```shell script
WORKFLOW_ID=$(curl -v \
  "${SECURITY_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  $CONDUCTOR_API/workflow \
  -d '
{
  "name": "wasm-example",
  "version": 1,
  "input": {
    "enter_your_name": "John"
  }
}
')
```

Check result:
```shell script
curl -v \
  "${SECURITY_HEADERS[@]}" \
  "${CONDUCTOR_API}/workflow/${WORKFLOW_ID}"
```

Output of the workflow execution should contain:
```json
{
   "result": {
      "name": "John",
      "name_length": 4
   }
}
```

Check logs of each task (use `taskId` from the output):
```shell script
curl -v \
  "${SECURITY_HEADERS[@]}" \
  "${CONDUCTOR_API}/tasks/${TASK_ID}/log"
```
Sample response:
```json
[{"log":"logging from js","taskId":"ffdf9d8a-19ff-410b-868c-329cb0d6b407","createdTime":1594813571032}]
```
Optionally delete testing workflow:
```shell script
curl -v "${SECURITY_HEADERS[@]}" ${CONDUCTOR_API}/metadata/workflow/wasm-example/1 -X DELETE
```

### QuickJs bugs, limitations:
* Syntax errors are printed to stdout

### Python bugs, limitations:
* Compared to QuickJs this approach introduces 5-200x worse latency for small scripts: ~30ms for QuickJs, ~.5s for Python
* Python needs writable lib directory, thus a temp directory needs to be created/deleted for each execution
