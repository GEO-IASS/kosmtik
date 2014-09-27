var fs = require('fs'),
    Tile = require('./Tile.js').Tile,
    VectorTile = require('./VectorTile.js').Tile,
    TILEPREFIX = 'tile';

var ProjectServer = function (project, parent) {
    this.project = project;
    this.parent = parent;
    this._poll_queue = [];
    var self = this;
    this.project.when('loaded', function () {
        self.mapPool = self.project.createMapPool();
        self.vectorMapPool = self.project.createMapPool({size: 256});
        fs.watch(self.project.root, function (type, filename) {
            if (filename.indexOf('.') === 0) return;
            self.addToPollQueue({isDirty: true});
            self.project.config.log('File', filename, 'changed on disk');
        });
    });
    this.project.load();
};

ProjectServer.prototype.serve = function (uri, res) {
    var urlpath = uri.pathname,
        els = urlpath.split('/'),
        self = this;
    if (!urlpath) this.parent.redirect(this.project.getUrl(), res);
    else if (urlpath === '/') this.main(res);
    else if (urlpath === '/options/') this.options(res);
    else if (urlpath === '/poll/') this.poll(res);
    else if (urlpath === '/export/') this.export(res, uri.query);
    else if (urlpath === '/reload/') this.reload(res);
    else if (this.parent.hasProjectRoute(urlpath)) this.parent._project_routes[urlpath].call(this, req, res, this.projects[els[1]]);
    else if (els[1] === TILEPREFIX && els.length === 5) this.project.when('loaded', function tile () {self.serveTile(els[2], els[3], els[4], res);});
    else this.parent.notFound(urlpath, res);
};

ProjectServer.prototype.serveTile = function (z, x, y, res) {
    y = y.split('.');
    var ext = y[1];
    y = y[0];
    if (ext === 'json') this.vectortile(z, x, y, res);
    else this.tile(z, x, y, res);
};

ProjectServer.prototype.tile = function (z, x, y, res) {
    var self = this;
    this.mapPool.acquire(function (err, map) {
        if (err) throw err;
        var tile = new Tile(z, x, y, {width: self.project.tileSize(), height: self.project.tileSize(), scale: self.project.mml.metatile});
        return tile.render(map, function (err, im) {
            if (err) throw err;
            im.encode('png', function (err, buffer) {
                res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': buffer.length});
                res.write(buffer);
                res.end();
                self.mapPool.release(map);
            });
        });
    });
};

ProjectServer.prototype.vectortile = function (z, x, y, res) {
    var self = this;
    this.vectorMapPool.acquire(function (err, map) {
        if (err) throw err;
        var tile = new VectorTile(+z, +x, +y);
        return tile.render(map, function (err, tile) {
            if (err) throw err;
            var content = JSON.stringify(tile.toGeoJSON('__all__'));
            res.writeHead(200, {'Content-Type': 'application/javascript'});
            res.write(content);
            res.end();
            self.vectorMapPool.release(map);
        });
    });
};

ProjectServer.prototype.options = function (res) {
    res.writeHead(200, {
        "Content-Type": "application/javascript",
    });
    var tpl = "var project = %;";
    res.write(tpl.replace('%', JSON.stringify(this.project.toFront())));
    res.end();
};

ProjectServer.prototype.export = function (res, options) {
    this.project.export(options, function (err, buffer) {
        res.writeHead(200, {
            'Content-Disposition': 'attachment; filename: "xxxx"'
        });
        res.write(buffer);
        res.end();
    });
};

ProjectServer.prototype.main = function (res) {
    var js = this.project.config._js.reduce(function(a, b) {
        return a + '<script src="' + b + '"></script>\n';
    }, '');
    var css = this.project.config._css.reduce(function(a, b) {
        return a + '<link rel="stylesheet" href="' + b + '" />\n';
    }, '');
    fs.readFile('src/front/project.html', {encoding: 'utf8'}, function(err, data) {
        if(err) throw err;
        data = data.replace('%%JS%%', js);
        data = data.replace('%%CSS%%', css);
        res.writeHead(200, {
            "Content-Type": 'text/html',
            "Content-Length" : data.length
        });
        res.end(data);
    });
};

ProjectServer.prototype.addToPollQueue = function (message) {
    if (this._poll_queue.indexOf(message) === -1) this._poll_queue.push(message);
};

ProjectServer.prototype.poll = function (res) {
    if (this._poll_queue.length) {
        data = JSON.stringify(this._poll_queue);
        this._poll_queue = [];
    } else {
        data = '';
    }
    res.writeHead(data.length ? 200 : 304, {
        "Content-Type": 'application/json',
        "Content-Length" : data.length
    });
    res.end(data);
};

ProjectServer.prototype.reload = function (res) {
    var self = this;
    this.project.reload();
    this.project.when('loaded', function () {
        self.mapPool.drain(function() {
            self.mapPool.destroyAllNow();
        });
        self.mapPool = self.project.createMapPool();
        res.writeHead(200, {
            "Content-Type": 'application/json'
        });
        res.end('{"reloaded": true}');
    });
};

exports.ProjectServer = ProjectServer;
