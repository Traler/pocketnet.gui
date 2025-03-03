var electron = null

let apiFetch = (...args) => fetch(...args);

if (typeof _Electron != 'undefined') {
    electron = require('electron');
    apiFetch = (...args) => proxyFetch(...args);
}

var rand = function(min, max){
    min = parseInt(min);
    max = parseInt(max);
    return Math.floor( Math.random() * (max - min + 1) ) + min;
}

var sequence = function(tasks, fn, result) {

    if(!tasks) tasks = []
    if(!result) result = []

    if(!tasks.length) return Promise.resolve(result)

    var task = tasks[0]

    return fn(task).then(r => {
        result.push(r)
        tasks.shift()
        return sequence(tasks, fn, result)
    })

}

var isonline = function(){

    if (window.cordova){
        
        if(navigator.connection.type === 'none') return false

        return true
    }

    if(typeof window.navigator != 'undefined' && window.navigator.onLine === false){
        return window.navigator.onLine
    }

    return true
}


var ProxyRequest = function(app = {}, proxy){
    var self = this

    var sign = function(data){
        var signature = null

        var session = ''

        if (proxy && proxy.session) session = proxy.session

        if (app.user && (app.user.getstate && app.user.getstate() == 1)){
            try{ signature = app.user.signature(session) } catch(e){}
        }

        if (signature){ data.signature = signature }

        return data
    }

    var timeout = function (ms, promise, controller) {

        var cancelled = false

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {

                if (controller.signal.dontabortable){
                    return
                }

                if (controller){
                    controller.abort()
                }
            }, ms)
      
            promise.then(value => {

                clearTimeout(timer)
                resolve(value)

            }).catch(reason => {

                clearTimeout(timer)

                reject(reason)

            })
        })
    }

    var direct = function(url, data, p){

        if(!p) p = {}

        if(typeof AbortController != 'undefined'){
            var controller = (new AbortController())

            var time = p.timeout || 30000
    
            if (window.cordova || isInStandaloneMode()){
                time = time * 2
            }

            if(data && data.method == 'sendrawtransactionwithmessage') time = time * 4

            //if(!isonline()) time = 3000
    
            return timeout(time, directclear(url, data, controller.signal, p), controller)
        }   
        else{
            return directclear(url, data, null, p)
        }

       
    }

    var directclear = function(url, data, signal, p){

        if(!p) p = {}

        if(!data) 
            data = {}

        var headers = _.extend({
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=utf-8'
        }, p.headers || {})

        /*if (data.bearer){
            headers.Authorization = `Bearer ${data.bearer}`
            delete data.bearer
        }*/

        var er = false

        if (p.auth)
            data = sign(data)
        else{
            if (app.user && (app.user.getstate && app.user.getstate() == 1)){ data.state = 1 }
        }

        return apiFetch(url, {

            method: p.method || 'POST',
            mode: 'cors', 
            headers: headers,
            signal : signal,
            body: JSON.stringify(data)

        }).then(r => {

            if (signal)
                signal.dontabortable = true

            if(!r.ok){
                er = true
            }

            return r.json()

        }).then(result => {

            if (er){
                return Promise.reject(result.error)
            }

            return Promise.resolve(result.data || {})

        }).catch(e => {

            if (e.code == 20){
                return Promise.reject({
                    code : 2000
                })
            }

            return Promise.reject(e)
        })
    }

    self.rpc = function(url, method, parameters, options){

        if(!method) return Promise.reject('method')

        var data = {}

            data.parameters = parameters || []
            data.method = method

            try{
                data.cachehash = MD5(JSON.stringify(data.parameters))
            }
            catch(e){
                
            }

            if (options)
                data.options = options

        var route = 'rpc'

        var requestoptions = {}

        if (options.ex) route = 'rpc-ex'

        return direct(url + '/'+route+'/' + method, data, requestoptions)

    }

    self.fetch = function(url, path, data, p){
        return direct(url + '/' + path, data, p)
    }

    return self
}

var ProxyNode = function(meta, app){
    var self = this

    self.host = meta.host || ""
    self.port = meta.port || 0
    self.wss = meta.wss || 0

    self.id = self.host + ":" + self.port + ":" + self.wss

    return self
}

var Proxy16 = function(meta, app, api){
    var self = this
    var request = new ProxyRequest(app, self)

    self.system = new System16(app, self, meta.direct)

    self.host = meta.host || ""
    self.port = meta.port || 0
    self.wss = meta.wss || 0
    self.direct = meta.direct
    self.user = meta.user || false

    self.current = null //current node

    self.id = self.host + ":" + self.port + ":" + self.wss
    self.enabled = true

    nodes = []

    var state = {
        hash : [],
        tick : {}
    }

    var internal = {
        node : {

            manage : {
                addlist : function(metas){
                    _.each(metas, meta => { this.add(meta) })
                },
                add : function(meta){
                    var node = new ProxyNode(meta, app)
                    nodes.push(node)
                }
            }
        }
    }

    self.changeNode = function(node){

        if (node && (!self.current || self.current.key != node.key)){
            self.current = node

            app.platform.ws.reconnect()

            _.each(self.clbks.changednode, function(c){
                c()
            })

            return true
        }
        
    }

    self.export = function(){
        return {
            host : self.host,
            port : self.port,
            wss : self.wss,
            user : self.user
        }
    }

    self.changed = function(settings){

        var reconnectws = false;

        if (settings.ports || settings.host){
            if((settings.ports || {}).https){
                self.port = settings.ports.https
            }

            if((settings.ports || {}).wss){
                self.wss = settings.ports.wss
                reconnectws = true
            }

            if(settings.host){
                self.host = settings.host
                reconnectws = true
            }

            var lastid = self.id 

            self.id = self.host + ":" + self.port + ":" + self.wss

            var currentapi = app.api.get.currentstring()


            app.api.editinsaved(lastid, self)

            if (currentapi == lastid){
                app.api.set.current(self.id, reconnectws)
            }
        }

        if (typeof settings.enabled != 'undefined'){
            self.enabled = settings.enabled
        }

        if (settings.ssl){
            reconnectws = true
        }

        if (settings.firebase){

        }


        _.each(self.clbks.changed, function(c){
            c(settings)
        })

        return reconnectws
    }

    var freshping = function(){

        if(!self.ping || self.ping < new Date()){return false}

        return true
    }

    self.api = {
        ping : () => {
            return self.fetch('ping', {}, {timeout : 4000}).then(r => {

                var rdate = new Date()

                self.ping = rdate.addSeconds(60)
                self.successping = true
                self.session = r.session

                if(!self.current && r.node && !api.get.fixednode()){
                    self.current = {
                        key : r.node
                    }
                }

                return Promise.resolve(r)
            }).catch(e => {

                var rdate = new Date()

                self.ping = rdate.addSeconds(10)
                
                return Promise.reject(e)
            })
        },

        actualping : function(){

            var promise = null

            if(!freshping()){
                promise = self.api.ping()
            }
            else{
                promise = Promise.resolve(true)
            }

            return promise.catch(e => {
                return Promise.resolve(false)
            })
        },

        nodes : {

            canchange : function(node){
                return self.fetch('nodes/canchange', {node}, 'wait').then(r => {

                    return Promise.resolve(self.changeNode(r.node))
                }).catch(e => {
                    return Promise.resolve(false)
                })
            },

            select : function(){

                var fixednode = ''

                if(api && api.get.fixednode()) fixednode = api.get.fixednode()

                return self.fetch('nodes/select', {fixed : fixednode}).then(r => {

                    self.current = r.node

                    return Promise.resolve(r)
                })
                
            },
            get : () => {
                return self.fetch('nodes/get').then(r => {
                    internal.node.manage.addlist(r.nodes)

                    return Promise.resolve(r)
                })
            },

            addlist : function(metas){
                _.each(metas, meta => { this.add(meta) })
            },

            add : function(meta){
                var node = new ProxyNode(meta, app)

                if(!this.find(node.id)){
                    nodes.push(node)
                }
                
            },

            find : function(id){
                return _.find(nodes, node => node.id == id)
            }
        }
    }

    self.url = {
        https : () => {return "https://" + self.host + ":" + self.port},
        wss : () => {return "wss://" + self.host + ":" + self.wss},

        http : () => {return "http://" + self.host + ":" + (self.port - 1)},
        ws : () => {return "ws://" + self.host + ":" + (self.wss - 1)}
    }


    self.rpc = function(method, parameters, options, trying){

        if(!trying) trying = 0

        if(!options) options = {}

        if (self.current){
            options.node = self.current.key
        }

        if (options.fnode){
            options.node = options.fnode
        }

        var promise = null

        if (self.direct){
            promise = self.system.rpc(method, parameters, options)
        }
        else{
            promise = request.rpc(self.url.https(), method, parameters, options)
        }

        return promise.then(r => {
            return Promise.resolve(r)
        }).catch(e => {

            if (options.fnode && e) e.code = 700

            if ((e.code == 408 || e.code == 429 || e.code == -28) && options.node && trying < 2 && !options.fnode){

                //if(isonline()){
                    return self.api.nodes.canchange(options.node).then(r => {

                        if (r){

                            return self.rpc(method, parameters, options, trying + 1)
                        }
    
                        return Promise.reject(e)
                    })
                //}

                
            }

            if (e.code == 2000){
                return Promise.reject(e)
            }

            return Promise.reject(e)

        })
    }

    var wait = {}

    self.fetch = function(path, data, p){

        var promise = null

        if (self.direct){
            promise = self.system.fetch(path, data, p)
        }
        else{
            promise = request.fetch(self.url.https(), path, data, p)
        }

        return promise.then(r => {
            return Promise.resolve(r)
        })
       
    }

    self.fetchauth = function(path, data, p){
        if(!p) p = {}
        p.auth = true

        return self.fetch(path, data, p)
    }

    self.get = {
        nodes : () => nodes,

        name : function(){
            if(self.direct) return 'Electron Proxy'

            else return self.url.https()
        },

        info : function(){
            return self.fetchauth('info')
        },

        stats : function(){
            return self.fetchauth('stats')
        }
    }

    self.valid = function(){
        return self.host && self.port && self.wss
    }

    self.init = function(){

        if (self.direct) {
            self.system.listen()
        }

        self.system.clbks.tick.proxy = function(settings, proxystate){

            if(!proxystate) return


            var hash = bitcoin.crypto.hash256(JSON.stringify(proxystate))

            var change = (hash.join('') !== state.hash.join(''))

            state.hash = hash
            state.tick = proxystate

            _.each(self.clbks.tick, (c) => { c(state.tick, change) })

        }

        if(api && api.get.fixednode()) {
            self.current = {
                key : api.get.fixednode()
            }
        }

        return Promise.resolve()

        // return self.refreshNodes()
    }

    self.refreshNodes = function(){

        return self.api.nodes.select().catch(e => {
            return Promise.resolve()
        })

    }

    self.destroy = function(){

        if(self.direct) self.system.stop()

        nodes = []
    }

    self.clbks = {
        tick : {},
        changed : {},
        changednode : {}
    }

    return self
}

var Api = function(app){
    var self = this

    var proxies = [];
    var nodes = []

    var current = null
    var useproxy = true;
    var inited = false;
    var fixednode = null;

    var getproxyas = function(key){

        if(!key){
            key = current
        }

        if(_.isObject(key)) return key

        var proxy = _.find(proxies, function(p){
            return p.id == key
        })

        return proxy
    }

    var getproxy = function(key){

        var proxy = getproxyas(key)

        return proxy ? Promise.resolve(proxy) : Promise.reject('proxy')
    }

    

    self.addproxy = function(meta){
        var lsproxies = JSON.parse(localStorage['listofproxies'] || "[]")

        var proxy = internal.proxy.manage.add(meta)

        if (proxy){

            lsproxies.push(meta)

            internal.proxy.manage.savelist(lsproxies)

            return proxy
        }
    }

    self.removeproxy = function(key){
        var lsproxies = JSON.parse(localStorage['listofproxies'] || "[]")

            lsproxies = _.filter(lsproxies, function(meta){
                var proxy = new Proxy16(meta, app, self)

                if(proxy.id == key) return false

                return true
            })

            proxies = _.filter(proxies, function(proxy){
                if(proxy.id != key || proxy.direct) return true

                else{
                    proxy.destroy()
                }
            })

        if(current == key && proxies.length) current = proxies[0].id

        internal.proxy.manage.savelist(lsproxies)
    }

    self.editinsaved = function(key, proxy){
        var lsproxies = JSON.parse(localStorage['listofproxies'] || "[]")

        var proxyinlist = _.find(lsproxies, function(p){

            var id = p.host + ":" + p.port + ":" + p.wss

            return id == key
        })


        if (proxyinlist){
            proxyinlist.host = proxy.host
            proxyinlist.port = proxy.port
            proxyinlist.wss = proxy.wss

            internal.proxy.manage.savelist(lsproxies)
        }
    }

    self.editproxy = function(key, meta){
        
        var proxy = self.get.byid(key)

        proxy.changed({
            host : meta.host,
            ports : {
                https : meta.port,
                wss : meta.wss
            }
        })

        return proxy
        
    }

    var internal = {
        api : {
            manage : {

            },
        },
        proxy : {

            manage : {
                savelist : function(lsproxies){
                    localStorage['listofproxies'] = JSON.stringify(lsproxies || [])
                },  
                initialMarker : function(initialProxies){

                    _.each(initialProxies, function(meta){
                        var proxy = internal.proxy.manage.find(meta.id)
            
                        if (proxy) proxy.initial = true
                    })
                    
                },
                init : function(){

                    var initialProxies = deep(app, 'options.listofproxies') || []

                    return this.addlocalelectronproxy().then(r => {

                        this.addlist(initialProxies)


                        try{ this.addlist(JSON.parse(localStorage['listofproxies'] || "[]")) }
                        catch(e){}

                        return Promise.resolve()

                    }).then(r => {

                        internal.proxy.manage.initialMarker(initialProxies)

                        var oldc = localStorage['currentproxy']

                        if (oldc){
                            return self.set.current(oldc)
                        }

                        return Promise.resolve()

                    }).catch(e => {

                        return Promise.resolve()

                    }).then(() => {

                        if(!current && initialProxies.length){
                            var rps = initialProxies[rand(0, initialProxies.length - 1)]
                            if (rps){
                                var randproxy = rps.host + ":" + rps.port + ":" + rps.wss
                                current = randproxy
                            }
                        }

                        inited = true

                        return Promise.resolve()

                    })

                },
                addlocalelectronproxy : function(){
                    if (electron){

                        var esystem = new System16(app, null, true)

                            esystem.listen()

                        return esystem.request('get.settings').then(settings => {

                            esystem.stop()

                            this.add({
                                direct : true,
                                host : 'localhost',
                                port : deep(settings, 'server.ports.https') || 0,
                                wss : deep(settings, 'server.ports.wss') || 0,
                            })

                            return Promise.resolve()

                        })
                    }

                    else{
                        return Promise.resolve()
                    }
                },
                addlist : function(metas){
                    _.each(metas, meta => { this.add(meta) })
                },
                add : function(meta){

                    var proxy = new Proxy16(meta, app, self)

                    if(!this.find(proxy.id) && (proxy.valid() || proxy.direct)){
                        proxies.push(proxy)
                        proxy.init()

                        return proxy
                    }
                    
                },

                find : function(id){
                    return _.find(proxies, proxy => proxy.id == id)
                }
            },

            api : {
                ping : function(proxies){
                    var promises = _.map(proxies, proxy => {
                        return proxy.api.ping()
                    })
        
                    return Promise.all(promises)
                },

                softping : function (proxies){

                    var result = false

                    return sequence(proxies, proxy => {

                        if(result) return Promise.resolve()

                        return proxy.api.actualping().then(r => {
                            result = true
                        })

                    })

                },
                
                mixedping : function(proxies){
                    var current = self.get.current()

                    if(!current) return Promise.resolve()

                    return current.api.actualping().catch(e => {return Promise.resolve()}).then(() => {


                        if(self.ready.use()) return Promise.resolve()

                        proxies = _.filter(proxies, function(p){
                            return p.id != current.id
                        })

                        return internal.proxy.api.softping(proxies).then(r => {

                            return Promise.resolve()
                        })

                    })
                }
            }
        }
    }

    self.rpc = function(method, parameters, options, trying){

        if(!trying) trying = 0

        if(!method) return Promise.reject('method')

        if(!options) 
            options = {}

        return getproxy(options.proxy).then(proxy => {
            return proxy.rpc(method, parameters, options.rpc)

        }).then(r => {

            app.apiHandlers.success({
                rpc : true
            })

            return Promise.resolve(r)

        }).catch(e => {


            if(!e) e = 'TypeError: Failed to fetch'

            if((!e.code || e.code == 2000) && trying < 2){

                //if(isonline()){
                    return self.changeProxyIfNeedWithDirect().then(r => {

                        trying++

                        return self.rpc(method, parameters, options, trying)
                    })
                //}
            }

            if (e.code != 700){

                if (e == 'TypeError: Failed to fetch' || e == 'proxy' || (e.code == 408 || e.code == -28)){

                    app.apiHandlers.error({
                        rpc : true
                    })

                }
            }

            return Promise.reject(e)

        })
    }

    self.changeProxyIfNeedWithDirect = function(){

        return self.changeProxyIfNeed().then(l => {

            if(!l){
                

                var proxy = self.get.direct() 

                if (proxy){
                    return self.set.current(proxy.id).then(r => {
                        proxy.api.nodes.canchange()
                    })
                }
            }

            return Promise.resolve()

        }).catch(() => {

            return Promise.resolve()
        })
    }

    self.fetchauthall = function(path, data){
        var promises = _.map(proxies, function(proxy){
            var options = {proxy : proxy.id}

            return self.fetchauth(path, data, options)
        })
        return Promise.all(promises).catch(e => {
            return Promise.resolve()
        })

       
    }

    self.fetchauth = function(path, data, options){
        if(!options) 
            options = {}

            options.auth = true

        return self.fetch(path, data, options)
    }   

    self.fetch = function(path, data, options){

        if(!useproxy) return Promise.reject('useproxy')

        if(!options) 
            options = {}


        var method = 'fetch'


        if(options.auth) method = 'fetchauth'


        var requestto = null

        return getproxy(options.proxy).then(proxy => {

            requestto = proxy.id

            return proxy[method](path, data)

        }).then(r => {

            if (requestto == current)

                app.apiHandlers.success({
                    api : true
                })

            return Promise.resolve(r)

        }).catch(e => {

            if (requestto == current && e == 'TypeError: Failed to fetch'){
                app.apiHandlers.error({
                    api : true
                })
            }

            return Promise.reject(e)
        })
    }

    self.ready = {
        proxies : () => {
            return _.filter(proxies, proxy => { return proxy.successping })
        },

        use : () => {


            return useproxy ? _.filter(proxies, proxy => { 
                return proxy.successping
            }).length || !proxies.length : false

        },

        useexternal : () => {

            return useproxy ? _.filter(proxies, proxy => { 
                return proxy.successping && !proxy.direct
            }).length || !proxies.length : false
            
        },
    }

    self.wait = {
        ready : function(key, total){

            if(!key) key = 'use'


            return pretry(self.ready[key], 20, total)
        }
    }

    self.set = {
        currentwithnode : function(ncurrent, reconnectws){
            var proxy = self.get.byid(ncurrent)

            if(!proxy) return Promise.reject('hasnt')

            current = ncurrent

            localStorage['currentproxy'] = current

            return proxy.api.nodes.select().then(r => {
                if (reconnectws && app.platform.ws)
                    app.platform.ws.reconnect()

                 return Promise.resolve(proxy)
            })
        },
        current : function(ncurrent, reconnectws){

            var proxy = self.get.byid(ncurrent)

            if(!proxy) return Promise.reject('hasnt')

            current = ncurrent

            localStorage['currentproxy'] = current

            if (reconnectws && app.platform.ws)
                app.platform.ws.reconnect()

            return Promise.resolve(proxy)

        },
        fixednode : function(id){
            fixednode = id
            
            localStorage['fixednode'] = fixednode


            if (fixednode){
                _.find(proxies, function(p){

                    p.current = {
                        key : fixednode
                    }
    
                })
            }
            
        }   
    }


    self.get = {
        fixednode : function(){
            return fixednode
        },
        currentwss : function(){
            return getproxy().then(proxy => {

                if(proxy.direct){
                    return {
                        dummy : proxy.system.wssdummy,
                        proxy : proxy
                    }
                }

                return {
                    url : proxy.url.wss(),
                    proxy : proxy
                }
            })
        },
        proxies : function(){
            return proxies
        },
        current : function(){
            return getproxyas()
        },

        currentstring : function(){
            return current
        },

        byid : function(id){
            return _.find(proxies, function(proxy){
                return proxy.id == id
            })
        },

        working : function(){

            var _proxies = _.filter(proxies, function(proxy){
                return !proxy.direct
            })

            var promises = _.map(_proxies, function(proxy){
                return proxy.api.actualping()
            })

            return Promise.all(promises).then(r => {
                return _.filter(proxies, function(p, i){
                    if (r[i]){
                        return true
                    }
                })
            })
        },

        direct : function(){
            var _proxies = _.filter(proxies, function(proxy){
                return proxy.direct
            })

            if(_proxies.length){
                return _proxies[0]
            }
        },


        proxywithwallet : function(){

            var f = false
            var e = false
            var es = 0

            _.each(proxies, function(p){
                p.get.info().then(r => {

                    var wallet = deep(r, 'info.wallet.addresses.registration') || {}

                    if (wallet.ready && wallet.unspents){
                        f = p
                    }

                    return Promise.resolve()

                }).catch(e => {
                    return Promise.resolve()
                }).finally(() => {
                    es++

                    if(es >= proxies.length){
                        e = true
                    }

                    return Promise.resolve()
                })
            })

            return pretry(function(){
                return e || f
            }).then(() => {
                return Promise.resolve(f)
            })

            
        }
    }

    var changeProxyFly = function(){

        return self.get.working().then(wproxies => {
            if (wproxies.length){ 
                return self.set.currentwithnode(wproxies[0].id)
            }

            return Promise.reject('unableChangeProxy')
        })
        
    }


    self.changeProxyIfNeed = function(){
        var pr = getproxyas()
        var promise = null

        if (pr){
            promise = pr.api.actualping()
        }
        else {
            promise = Promise.resolve(false)
        }

        return promise.then(r => {
            if(r){
                return Promise.resolve(1)
            }
            else{
                return self.get.working().then(wproxies => {

                    if (wproxies.length){ 
                        self.set.currentwithnode(wproxies[0].id, true)
                    }

                    return Promise.resolve(wproxies.length)
                })
            }
        })
    },

    self.init = function(){

        var f = localStorage['fixednode']

        if(f && f != 'null') fixednode = f

        return internal.proxy.manage.init().then(r => { 
            //softping


            internal.proxy.api.mixedping(proxies).catch(e => {
            })

            return Promise.resolve()
        })
    }

    self.initIf = function(){

        if(inited) return Promise.resolve()
        else return self.init()

    }

    self.destroy = function(){
        proxies = []
        inited = false
    }

    return self
}   

if(typeof module != "undefined"){ module.exports = {Api, ProxyRequest, Proxy16, ProxyNode}; } 
else { window.Api = Api; window.ProxyRequest = ProxyRequest; window.Proxy16 = Proxy16 }
