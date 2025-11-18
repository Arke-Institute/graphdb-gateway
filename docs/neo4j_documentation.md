1. Install
Install the Neo4j Javascript driver with npm:
npm i neo4j-driver@~5.28.0

More info on installing the driver
2. Connect to the database
Connect to a database by creating a Driver object and providing a URL and an authentication token. Once you have a Driver instance, use the .getServerInfo() method to ensure that a working connection can be established.
var neo4j = require('neo4j-driver');
(async () => {
  // URI examples: 'neo4j://localhost', 'neo4j+s://xxx.databases.neo4j.io'
  const URI = '<database-uri>'
  const USER = '<username>'
  const PASSWORD = '<password>'
  let driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
  const serverInfo = await driver.getServerInfo()
  console.log('Connection established')
  console.log(serverInfo)

  // Use the driver to run queries

  await driver.close()
})();


More info on connecting to a database
3. Create an example graph
Run a Cypher query with the method Driver.executeQuery(). Do not hardcode or concatenate parameters: use placeholders and specify the parameters as key-value pairs.
Create two Person nodes and a KNOWS relationship between them
let { records, summary } = await driver.executeQuery(`
  CREATE (a:Person {name: $name})
  CREATE (b:Person {name: $friendName})
  CREATE (a)-[:KNOWS]->(b)
  `,
  { name: 'Alice', friendName: 'David' },
  { database: '<database-name>' }
)
console.log(
  `Created ${summary.counters.updates().nodesCreated} nodes ` +
  `in ${summary.resultAvailableAfter} ms.`
)

More info on querying the database
4. Query a graph
To retrieve information from the database, use the Cypher clause MATCH:
Retrieve all Person nodes who know other persons
let { records, summary } = await driver.executeQuery(`
  MATCH (p:Person)-[:KNOWS]->(:Person)
  RETURN p.name AS name
  `,
  {},
  { database: '<database-name>' }
)

// Loop through users and do something with them
for(let record of records) {
  console.log(`Person with name: ${record.get('name')}`)
  console.log(`Available properties for this node are: ${record.keys}\n`)
}

// Summary information
console.log(
  `The query \`${summary.query.text}\` ` +
  `returned ${records.length} nodes.\n`
)


More info on querying the database
5. Close connections and sessions
Call the .close() method on the Driver instance when you are finished with it, to release any resources still held by it. The same applies to any open sessions.
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
let session = driver.session({ database: '<database-name>' })

// session/driver usage

session.close()
driver.close()


Neo4j Docs
Docs
Docs
Labs
Get Help
GraphAcademy
Get Started Free
Skip to content
Neo4j JavaScript Driver Manual

Version 6 (Current)
Quickstart
Basic workflow
Installation
Connect to the database
Query the database
Advanced usage
Run your own transactions
Explore the query execution summary
Asynchronous queries
Coordinate parallel transactions
Further query mechanisms
Performance recommendations
Usage within a browser (WebSockets)
Reference
Advanced connection information
Data types and mapping to Cypher types
Upgrade from older versions
API documentation
GraphAcademy courses
Graph Data Modeling Fundamentals
Intermediate Cypher Queries
Building Neo4j Applications with Node.js
Building Neo4j Applications with TypeScript
Is this page helpful?

Neo4j JavaScript Driver Manual
Query the database
Raise an issue
Query the database
Once you have connected to the database, you can run Cypher queries through the method Driver.executeQuery().

Due to the usage of async/await, the examples in this page need to be wrapped in an async function. See a full example if you are unsure how to do it.

Write to the database
To create two nodes representing persons named Alice and David, and a relationship KNOWS between them, use the Cypher clause CREATE:

Create two nodes and a relationship
let { records, summary } = await driver.executeQuery(`  
  CREATE (a:Person {name: $name})
  CREATE (b:Person {name: $friendName})
  CREATE (a)-[:KNOWS]->(b)
  `,
  { name: 'Alice', friendName: 'David' },  
  { database: '<database-name>' }  
)
console.log(
  `Created ${summary.counters.updates().nodesCreated} nodes ` +
  `in ${summary.resultAvailableAfter} ms.`
)
The Cypher query.
An object of query parameters.
The database to run the query on
Read from the database
To retrieve information from the database, use the Cypher clause MATCH:

Retrieve all Person nodes who like other Person s
let { records, summary } = await driver.executeQuery(`
  MATCH (p:Person)-[:KNOWS]->(:Person)
  RETURN p.name AS name
  `,
  {},
  { database: '<database-name>' }
)

// Loop through users and do something with them
for(let record of records) {  
  console.log(`Person with name: ${record.get('name')}`)
  console.log(`Available properties for this node are: ${record.keys}\n`)
}

// Summary information
console.log(  
  `The query \`${summary.query.text}\` ` +
  `returned ${records.length} nodes.\n`
)
records contains the actual result as a list of Record objects.
summary contains the summary of execution returned by the server.
Update the database
To update a node’s information in the database, use the Cypher clauses MATCH and SET:

Update node Alice to add an age property
let { _, summary } = await driver.executeQuery(`
  MATCH (p:Person {name: $name})
  SET p.age = $age
  `,
  { name: 'Alice', age: 42 },
  { database: '<database-name>' }
)
console.log('Query counters:')
console.log(summary.counters.updates())
To create a new relationship, linking it to two already existing node, use a combination of the Cypher clauses MATCH and CREATE:

Create a relationship :KNOWS between Alice and Bob
let { records, summary } = await driver.executeQuery(`
  MATCH (alice:Person {name: $name})  
  MATCH (bob:Person {name: $friendName})  
  CREATE (alice)-[:KNOWS]->(bob)  
  `, { name: 'Alice', friendName: 'Bob' },
  { database: '<database-name>' }
)
console.log('Query counters:')
console.log(summary.counters.updates())
Retrieve the person node named Alice and bind it to a variable alice
Retrieve the person node named Bob and bind it to a variable bob
Create a new :KNOWS relationship outgoing from the node bound to alice and attach to it the Person node named Bob
Delete from the database
To remove a node and any relationship attached to it, use the Cypher clause DETACH DELETE:

Remove the Alice node
// This does not delete _only_ p, but also all its relationships!
let { _, summary } = await driver.executeQuery(`
  MATCH (p:Person WHERE p.name = $name)
  DETACH DELETE p
  `, { name: 'Alice' },
  { database: '<database-name>' }
)
console.log('Query counters:')
console.log(summary.counters.updates())
Query parameters
Do not hardcode or concatenate parameters directly into queries. Instead, always use placeholders and provide dynamic data as Cypher parameters. This is for:

performance benefits: Neo4j compiles and caches queries, but can only do so if the query structure is unchanged;

security reasons: protecting against Cypher injection.

There can be circumstances where your query structure prevents the usage of parameters in all its parts. For those rare use cases, see Dynamic values in property keys, relationship types, and labels.
Error handling
A query run may fail for a number of reasons.

When using Driver.executeQuery(), the driver automatically retries to run a failed query if the failure is deemed to be transient (for example due to temporary server unavailability). An error will be raised if the operation keeps failing after the configured maximum retry time.

All errors coming from the server are subclasses of Neo4jError. You can use an exception’s code to stably identify a specific error; error messages are instead not stable markers, and should not be relied upon.

Basic error handling
try {
  let err = await driver.executeQuery(
    'MATCH (p:Person) RETURN ',
    {},
    { database: '<database-name>' }
  )
} catch (err) {
  console.log('Neo4j error code:', err.code)
  console.log('Error message:', err.message)
}
/*
Neo4j error code: Neo.ClientError.Statement.SyntaxError
Error message: Neo4jError: Invalid input '': expected an expression, '*', 'ALL' or 'DISTINCT' (line 1, column 25 (offset: 24))
"MATCH (p:Person) RETURN"
                         ^
*/
Error objects also expose errors as GQL-status objects. The main difference between Neo4j error codes and GQL error codes is that the GQL ones are more granular: a single Neo4j error code might be broken in several, more specific GQL error codes.

The actual cause that triggered an error is sometimes found in the optional GQL-status object .cause, which is itself a Neo4jError. You might need to recursively traverse the cause chain before reaching the root cause of the error you caught. In the example below, the error’s GQL status code is 42001, but the actual source of the error has status code 42I06.

Usage of Neo4jError with GQL-related methods
try {
  let err = await driver.executeQuery(
    'MATCH (p:Person) RETURN ',
    {},
    { database: '<database-name>' }
  )
} catch (err) {
  console.log('Error GQL status:', err.gqlStatus)
  console.log('Error GQL status description:', err.gqlStatusDescription)
  console.log('Error GQL classification:', err.classification)
  console.log('Error GQL cause:', err.cause.message)
  console.log('Error GQL diagnostic record:', err.diagnosticRecord)
}
/*
Error GQL status: 42001
Error GQL status description: error: syntax error or access rule violation - invalid syntax
Error GQL classification: CLIENT_ERROR
Error GQL cause: GQLError: 42I06: Invalid input '', expected: an expression, '*', 'ALL' or 'DISTINCT'.
Error GQL diagnostic record: {
  OPERATION: '',
  OPERATION_CODE: '0',
  CURRENT_SCHEMA: '/',
  _classification: 'CLIENT_ERROR',
  _position: {
    line: Integer { low: 1, high: 0 },
    column: Integer { low: 25, high: 0 },
    offset: Integer { low: 24, high: 0 }
  }
}
*/
View all (15 more lines)
GQL status codes are particularly helpful when you want your application to behave differently depending on the exact error that was raised by the server.

Distinguishing between different error codes
try {
  let err = await driver.executeQuery(
    'MATCH (p:Person) RETURN ',
    {},
    { database: '<database-name>' }
  )
} catch (err) {
    if (err.findByGqlStatus('42001')) {
        // Neo.ClientError.Statement.SyntaxError
        // special handling of syntax error in query
        console.log(err.message)
    } else if (err.findByGqlStatus('42NFF')) {
        // Neo.ClientError.Security.Forbidden
        // special handling of user not having CREATE permissions
        console.log(err.message)
    } else {
        // handling of all other errors
        console.log(err.message)
    }
}
View all (5 more lines)
The GQL status code 50N42 is returned when an error does not have a GQL-status object. This can happen if the driver is connected to an older Neo4j server. Don’t rely on this status code, as future Neo4j server versions might change it with a more appropriate one.

Transient server errors can be retried without need to alter the original request. You can discover whether an error is transient via the method Neo4jError.isRetryable(), which gives insights into whether a further attempt might be successful. This is particular useful when running queries in explicit transactions, to know if a failed query is worth re-running.

Query configuration
You can supply a QueryConfig object as third (optional) parameter to alter the default behavior of .executeQuery().

Database selection
Always specify the database explicitly with the database parameter, even on single-database instances. This allows the driver to work more efficiently, as it saves a network round-trip to the server to resolve the home database. If no database is given, the user’s home database is used.

await driver.executeQuery(
  'MATCH (p:Person) RETURN p.name',
  {},
  {
    database: '<database-name>'
  }
)
Specifying the database through the configuration parameter is preferred over the USE Cypher clause. If the server runs on a cluster, queries with USE require server-side routing to be enabled. Queries can also take longer to execute as they may not reach the right cluster member at the first attempt, and need to be routed to one containing the requested database.
Request routing
In a cluster environment, all queries are directed to the leader node by default. To improve performance on read queries, you can use the configuration routing: 'READ' to route a query to the read nodes.

await driver.executeQuery(
  'MATCH (p:Person) RETURN p.name',
  {},
  {
    routing: 'READ',  // short for neo4j.routing.READ
    database: '<database-name>'
  }
)
Although executing a write query in read mode results in a runtime error, you should not rely on this for access control. The difference between the two modes is that read transactions will be routed to any node of a cluster, whereas write ones are directed to primaries. There is no security guarantee that a write query submitted in read mode will be rejected.

Run queries as a different user
You can execute a query through a different user with the configuration parameter auth. Switching user at the query level is cheaper than creating a new Driver object. The query is then run within the security context of the given user (i.e., home database, permissions, etc.).

await driver.executeQuery(
  'MATCH (p:Person) RETURN p.name',
  {},
  {
    auth: neo4j.auth.basic('<username>', '<password>'),
    database: '<database-name>'
  }
)
The parameter impersonatedUser provides a similar functionality. The difference is that you don’t need to know a user’s password to impersonate them, but the user under which the Driver was created needs to have the appropriate permissions.

await driver.executeQuery(
  'MATCH (p:Person) RETURN p.name',
  {},
  {
    impersonatedUser: '<username>',
    database: '<database-name>'
  }
)
A full example
const neo4j = require('neo4j-driver');

(async () => {
  const URI = '<database-uri>'
  const USER = '<username>'
  const PASSWORD = '<password>'
  let driver, result

  let people = [{name: 'Alice', age: 42, friends: ['Bob', 'Peter', 'Anna']},
                {name: 'Bob', age: 19},
                {name: 'Peter', age: 50},
                {name: 'Anna', age: 30}]

  // Connect to database
  try {
    driver = neo4j.driver(URI,  neo4j.auth.basic(USER, PASSWORD))
    await driver.verifyConnectivity()
  } catch(err) {
    console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    await driver.close()
    return
  }

  // Create some nodes
  for(let person of people) {
    await driver.executeQuery(
      'MERGE (p:Person {name: $person.name, age: $person.age})',
      { person: person },
      { database: '<database-name>' }
    )
  }

  // Create some relationships
  for(let person of people) {
    if(person.friends != undefined) {
      await driver.executeQuery(`
        MATCH (p:Person {name: $person.name})
        UNWIND $person.friends AS friendName
        MATCH (friend:Person {name: friendName})
        MERGE (p)-[:KNOWS]->(friend)
        `, { person: person },
        { database: '<database-name>' }
      )
    }
  }

  // Retrieve Alice's friends who are under 40
  result = await driver.executeQuery(`
    MATCH (p:Person {name: $name})-[:KNOWS]-(friend:Person)
    WHERE friend.age < $age
    RETURN friend
    `, { name: 'Alice', age: 40 },
    { database: '<database-name>' }
  )

  // Loop through results and do something with them
  for(let person of result.records) {
    // `person.friend` is an object of type `Node`
    console.log(person.get('friend'))
  }

  // Summary information
  console.log(
    `The query \`${result.summary.query.text}\` ` +
    `returned ${result.records.length} records ` +
    `in ${result.summary.resultAvailableAfter} ms.`
  )

  await driver.close()
})();
Connect to the database
Run your own transactions
Contents
Write to the database
Read from the database
Update the database
Delete from the database
Query parameters
Error handling
Query configuration
Database selection
Request routing
Run queries as a different user
A full example
Learn
 Sandbox
 Neo4j Community Site
 Neo4j Developer Blog
 Neo4j Videos
 GraphAcademy
 Neo4j Labs
Social
 Twitter
 Meetups
 Github
 Stack Overflow
Want to Speak?
Contact Us →
US: 1-855-636-4532
Sweden +46 171 480 113
UK: +44 20 3868 3223
France: +33 (0) 1 88 46 13 20
© 2025 Neo4j, Inc.
Terms | Privacy | Sitemap

Neo4j®, Neo Technology®, Cypher®, Neo4j® Bloom™ and Neo4j® Aura™ are registered trademarks of Neo4j, Inc. All other marks are owned by their respective companies.


AI search
Home
Reference
Source
 

CAuthTokenManagers
CClientCertificateProviders
CDriver
CGQLError
CNeo4jError
CNode
CPath
CPathSegment
CRelationship
CInteger
CGqlStatusObject
CNotification
CProtocolVersion
CRecord
CEagerResult
CPlan
CProfiledPlan
CQueryStatistics
CResultSummary
CServerInfo
CStats
CResultTransformers
CGenericResult
CResult
CSession
CPoint
CDate
CDateTime
CDuration
CLocalDateTime
CLocalTime
CTime
CManagedTransaction
CTransactionPromise
CTransaction
CInternalConfig
CUnsupportedType
CVector
IAuthTokenAndExpiration
IAuthTokenManager
IBookmarkManager
IClientCertificate
IClientCertificateProvider
IRotatingClientCertificateProvider
IQueryConfig
ISessionConfig
INotificationFilter
IConfig
FbookmarkManager
FisNode
FisPath
FisPathSegment
FisRelationship
Fas
FvalueAs
FisPoint
FisDate
FisDateTime
FisDuration
FisLocalDateTime
FisLocalTime
FisTime
FisUnsupportedType
FisVector
Fvector
VauthTokenManagers
Vauth
VclientCertificateProviders
VREAD
VWRITE
Vrouting
VPROTOCOL_ERROR
VSERVICE_UNAVAILABLE
VSESSION_EXPIRED
VisRetriableError
VisRetryableError
VrawPolyfilledDiagnosticRecord
Verror
VinSafeRange
Vint
VisInt
VtoNumber
VtoString
VforExport
VRecordObjectMapping
VrulesRegistry
VnameConventions
Vrule
VnotificationFilterDisabledCategory
VnotificationFilterDisabledClassification
VnotificationFilterMinimumSeverityLevel
VnotificationCategory
VnotificationClassification
VnotificationSeverityLevel
VqueryType
VresultTransformers
TBookmarkManagerConfig
TKeyFileObject
TRoutingControl
TErrorClassification
TNotificationFilterDisabledCategory
TNotificationFilterDisabledClassification
TNotificationFilterMinimumSeverityLevel
TNotificationCategory
TNotificationClassification
TNotificationSeverityLevel
TResultTransformer
TVectorType
CDriver
CRxResult
CRxSession
CRxManagedTransaction
CRxTransaction
Fdriver
FhasReachableServer
VforExport
Vgraph
Vinteger
Vlogging
Vsession
Vspatial
Vtemporal
Vtypes
TTransactionConfig
Neo4j Driver for JavaScript
This is the official Neo4j driver for JavaScript.

Starting with 6.0, the Neo4j Drivers is no longer on a monthly release cadence. Minor version releases will happen when there are sufficient new features or improvements to warrant them. This is to reduce the required work of users updating their driver.

As a policy, patch versions will not be released except on rare occasions. Bug fixes and updates will go into the latest minor version and users should upgrade to that. Driver upgrades within a major version will never contain breaking API changes.

See also: https://neo4j.com/developer/kb/neo4j-supported-versions/

Resources to get you started:

API Documentation
Neo4j Driver Manual
Neo4j Cypher Cheatsheet
What's New in 6.x
Changelog
Including the Driver
In Node.js application
Stable channel:

npm install neo4j-driver
Pre-release channel:

npm install neo4j-driver@next
Please note that @next only points to pre-releases that are not suitable for production use. To get the latest stable release omit @next part altogether or use @latest instead.

var neo4j = require('neo4j-driver')
Driver instance should be closed when Node.js application exits:

driver.close() // returns a Promise
otherwise application shutdown might hang or it might exit with a non-zero exit code.

In web browser
We build a special browser version of the driver, which supports connecting to Neo4j over WebSockets. It can be included in an HTML page using one of the following tags:

<!-- Direct reference -->
<script src="lib/browser/neo4j-web.min.js"></script>

<!-- unpkg CDN non-minified -->
<script src="https://unpkg.com/neo4j-driver"></script>
<!-- unpkg CDN minified for production use, version X.Y.Z -->
<script src="https://unpkg.com/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.min.js"></script>

<!-- jsDelivr CDN non-minified -->
<script src="https://cdn.jsdelivr.net/npm/neo4j-driver"></script>
<!-- jsDelivr CDN minified for production use, version X.Y.Z -->
<script src="https://cdn.jsdelivr.net/npm/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.min.js"></script>
This will make a global neo4j object available, where you can create a driver instance with neo4j.driver:

var driver = neo4j.driver(
  'neo4j://localhost',
  neo4j.auth.basic('neo4j', 'password')
)
From 5.4.0, this version is also exported as ECMA Script Module. It can be imported from a module using the following statements:

// Direct reference
import neo4j from 'lib/browser/neo4j-web.esm.min.js'

// unpkg CDN non-minified , version X.Y.Z where X.Y.Z >= 5.4.0
import neo4j from 'https://unpkg.com/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.esm.js'

// unpkg CDN minified for production use, version X.Y.Z where X.Y.Z >= 5.4.0
import neo4j from 'https://unpkg.com/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.esm.min.js'

// jsDelivr CDN non-minified, version X.Y.Z where X.Y.Z >= 5.4.0
import neo4j from 'https://cdn.jsdelivr.net/npm/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.esm.js'

// jsDelivr CDN minified for production use, version X.Y.Z where X.Y.Z >= 5.4.0
import neo4j from 'https://cdn.jsdelivr.net/npm/neo4j-driver@X.Y.Z/lib/browser/neo4j-web.esm.min.js'
It is not required to explicitly close the driver on a web page. Web browser should gracefully close all open WebSockets when the page is unloaded. However, driver instance should be explicitly closed when it's lifetime is not the same as the lifetime of the web page:

driver.close() // returns a Promise
Usage examples
Constructing a Driver
// Create a driver instance, for the user `neo4j` with password `password`.
// It should be enough to have a single driver per database per application.
var driver = neo4j.driver(
  'neo4j://localhost',
  neo4j.auth.basic('neo4j', 'password')
)

// Close the driver when application exits.
// This closes all used network connections.
await driver.close()
Acquiring a Session
Regular Session
// Create a session to run Cypher statements in.
// Note: Always make sure to close sessions when you are done using them!
var session = driver.session()
with a Default Access Mode of READ
var session = driver.session({ defaultAccessMode: neo4j.session.READ })
with Bookmarks
var session = driver.session({
  bookmarks: [bookmark1FromPreviousSession, bookmark2FromPreviousSession]
})
against a Database
var session = driver.session({
  database: 'foo',
  defaultAccessMode: neo4j.session.WRITE
})
Reactive Session
// Create a reactive session to run Cypher statements in.
// Note: Always make sure to close sessions when you are done using them!
var rxSession = driver.rxSession()
with a Default Access Mode of READ
var rxSession = driver.rxSession({ defaultAccessMode: neo4j.session.READ })
with Bookmarks
var rxSession = driver.rxSession({
  bookmarks: [bookmark1FromPreviousSession, bookmark2FromPreviousSession]
})
against a Database
var rxSession = driver.rxSession({
  database: 'foo',
  defaultAccessMode: neo4j.session.WRITE
})
Executing Queries
Consuming Records with Streaming API
// Run a Cypher statement, reading the result in a streaming manner as records arrive:
session
  .run('MERGE (alice:Person {name : $nameParam}) RETURN alice.name AS name', {
    nameParam: 'Alice'
  })
  .subscribe({
    onKeys: keys => {
      console.log(keys)
    },
    onNext: record => {
      console.log(record.get('name'))
    },
    onCompleted: () => {
      session.close() // returns a Promise
    },
    onError: error => {
      console.log(error)
    }
  })
Subscriber API allows following combinations of onKeys, onNext, onCompleted and onError callback invocations:

zero or one onKeys,
zero or more onNext followed by onCompleted when operation was successful. onError will not be invoked in this case
zero or more onNext followed by onError when operation failed. Callback onError might be invoked after couple onNext invocations because records are streamed lazily by the database. onCompleted will not be invoked in this case.
Consuming Records with Promise API
// the Promise way, where the complete result is collected before we act on it:
session
  .run('MERGE (james:Person {name : $nameParam}) RETURN james.name AS name', {
    nameParam: 'James'
  })
  .then(result => {
    result.records.forEach(record => {
      console.log(record.get('name'))
    })
  })
  .catch(error => {
    console.log(error)
  })
  .then(() => session.close())
Consuming Records with Reactive API
rxSession
  .run('MERGE (james:Person {name: $nameParam}) RETURN james.name AS name', {
    nameParam: 'Bob'
  })
  .records()
  .pipe(
    map(record => record.get('name')),
    concatWith(rxSession.close())
  )
  .subscribe({
    next: data => console.log(data),
    complete: () => console.log('completed'),
    error: err => console.log(err)
  })
Transaction functions
// Transaction functions provide a convenient API with minimal boilerplate and
// retries on network fluctuations and transient errors. Maximum retry time is
// configured on the driver level and is 30 seconds by default:
// Applies both to standard and reactive sessions.
neo4j.driver('neo4j://localhost', neo4j.auth.basic('neo4j', 'password'), {
  maxTransactionRetryTime: 30000
})
Reading with Async Session
// It is possible to execute read transactions that will benefit from automatic
// retries on both single instance ('bolt' URI scheme) and Causal Cluster
// ('neo4j' URI scheme) and will get automatic load balancing in cluster deployments
var readTxResultPromise = session.executeRead(txc => {
  // used transaction will be committed automatically, no need for explicit commit/rollback

  var result = txc.run('MATCH (person:Person) RETURN person.name AS name')
  // at this point it is possible to either return the result or process it and return the
  // result of processing it is also possible to run more statements in the same transaction
  return result
})

// returned Promise can be later consumed like this:
readTxResultPromise
  .then(result => {
    console.log(result.records)
  })
  .catch(error => {
    console.log(error)
  })
  .then(() => session.close())
Reading with Reactive Session
rxSession
  .executeRead(txc =>
    txc
      .run('MATCH (person:Person) RETURN person.name AS name')
      .records()
      .pipe(map(record => record.get('name')))
  )
  .subscribe({
    next: data => console.log(data),
    complete: () => console.log('completed'),
    error: err => console.log(error)
  })
Writing with Async Session
// It is possible to execute write transactions that will benefit from automatic retries
// on both single instance ('bolt' URI scheme) and Causal Cluster ('neo4j' URI scheme)
var writeTxResultPromise = session.executeWrite(async txc => {
  // used transaction will be committed automatically, no need for explicit commit/rollback

  var result = await txc.run(
    "MERGE (alice:Person {name : 'Alice'}) RETURN alice.name AS name"
  )
  // at this point it is possible to either return the result or process it and return the
  // result of processing it is also possible to run more statements in the same transaction
  return result.records.map(record => record.get('name'))
})

// returned Promise can be later consumed like this:
writeTxResultPromise
  .then(namesArray => {
    console.log(namesArray)
  })
  .catch(error => {
    console.log(error)
  })
  .then(() => session.close())
Writing with Reactive Session
rxSession
  .executeWrite(txc =>
    txc
      .run("MERGE (alice:Person {name: 'James'}) RETURN alice.name AS name")
      .records()
      .pipe(map(record => record.get('name')))
  )
  .subscribe({
    next: data => console.log(data),
    complete: () => console.log('completed'),
    error: error => console.log(error)
  })
Explicit Transactions
With Async Session
// run statement in a transaction
const txc = session.beginTransaction()
try {
  const result1 = await txc.run(
    'MERGE (bob:Person {name: $nameParam}) RETURN bob.name AS name',
    {
      nameParam: 'Bob'
    }
  )
  result1.records.forEach(r => console.log(r.get('name')))
  console.log('First query completed')

  const result2 = await txc.run(
    'MERGE (adam:Person {name: $nameParam}) RETURN adam.name AS name',
    {
      nameParam: 'Adam'
    }
  )
  result2.records.forEach(r => console.log(r.get('name')))
  console.log('Second query completed')

  await txc.commit()
  console.log('committed')
} catch (error) {
  console.log(error)
  await txc.rollback()
  console.log('rolled back')
} finally {
  await session.close()
}
With Reactive Session
rxSession
  .beginTransaction()
  .pipe(
    mergeMap(txc =>
      concatWith(
        txc
          .run(
            'MERGE (bob:Person {name: $nameParam}) RETURN bob.name AS name',
            {
              nameParam: 'Bob'
            }
          )
          .records()
          .pipe(map(r => r.get('name'))),
        of('First query completed'),
        txc
          .run(
            'MERGE (adam:Person {name: $nameParam}) RETURN adam.name AS name',
            {
              nameParam: 'Adam'
            }
          )
          .records()
          .pipe(map(r => r.get('name'))),
        of('Second query completed'),
        txc.commit(),
        of('committed')
      ).pipe(catchError(err => txc.rollback().pipe(throwError(() => err))))
    )
  )
  .subscribe({
    next: data => console.log(data),
    complete: () => console.log('completed'),
    error: error => console.log(error)
  })
Numbers and the Integer type
The Neo4j type system uses 64-bit signed integer values. The range of values is between -(2<sup>64</sup>- 1) and (2<sup>63</sup>- 1).

However, JavaScript can only safely represent integers between Number.MIN_SAFE_INTEGER -(2<sup>53</sup>- 1) and Number.MAX_SAFE_INTEGER (2<sup>53</sup>- 1).

In order to support the full Neo4j type system, the driver will not automatically convert to javascript integers. Any time the driver receives an integer value from Neo4j, it will be represented with an internal integer type by the driver.

Any javascript number value passed as a parameter will be recognized as Float type.

Writing integers
Numbers written directly e.g. session.run("CREATE (n:Node {age: $age})", {age: 22}) will be of type Float in Neo4j.

To write the age as an integer the neo4j.int method should be used:

var neo4j = require('neo4j-driver')

session.run('CREATE (n {age: $myIntParam})', { myIntParam: neo4j.int(22) })
To write an integer value that are not within the range of Number.MIN_SAFE_INTEGER -(2<sup>53</sup>- 1) and Number.MAX_SAFE_INTEGER (2<sup>53</sup>- 1), use a string argument to neo4j.int:

session.run('CREATE (n {age: $myIntParam})', {
  myIntParam: neo4j.int('9223372036854775807')
})
Reading integers
In Neo4j, the type Integer can be larger what can be represented safely as an integer with JavaScript Number.

It is only safe to convert to a JavaScript Number if you know that the number will be in the range Number.MIN_SAFE_INTEGER -(2<sup>53</sup>- 1) and Number.MAX_SAFE_INTEGER (2<sup>53</sup>- 1).

In order to facilitate working with integers the driver include neo4j.isInt, neo4j.integer.inSafeRange, neo4j.integer.toNumber, and neo4j.integer.toString.

var smallInteger = neo4j.int(123)
if (neo4j.integer.inSafeRange(smallInteger)) {
  var aNumber = smallInteger.toNumber()
}
If you will be handling integers that is not within the JavaScript safe range of integers, you should convert the value to a string:

var largeInteger = neo4j.int('9223372036854775807')
if (!neo4j.integer.inSafeRange(largeInteger)) {
  var integerAsString = largeInteger.toString()
}
Enabling native numbers
Starting from 1.6 version of the driver it is possible to configure it to only return native numbers instead of custom Integer objects. The configuration option affects all integers returned by the driver. Enabling this option can result in a loss of precision and incorrect numeric values being returned if the database contains integer numbers outside of the range [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]. To enable potentially lossy integer values use the driver's configuration object:

var driver = neo4j.driver(
  'neo4j://localhost',
  neo4j.auth.basic('neo4j', 'password'),
  { disableLosslessIntegers: true }
)
Generated by ESDoc(1.1.0)