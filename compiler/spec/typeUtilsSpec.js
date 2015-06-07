'use strict';

var typeUtils = require('../typeUtils.js');
var errors = require('../errors.js');

describe('Type utils suite:', function() {
  it('Unification of several variables', function() {
    var a = typeUtils.createVariableType();
    var b = typeUtils.createVariableType();
    var c = typeUtils.createVariableType();
    var d = typeUtils.createVariableType();
    var e = typeUtils.createVariableType();

    typeUtils.unifyTypes(a, b);
    typeUtils.unifyTypes(b, c);
    expect(a.fields.uid).toBe(b.fields.uid);
    expect(b.fields.uid).toBe(c.fields.uid);
    expect(a.fields.uid).toBe(c.fields.uid);
    var aUid = a.fields.uid;

    typeUtils.unifyTypes(d, e);
    expect(d.fields.uid).toBe(e.fields.uid);

    expect(a.fields.uid).not.toBe(e.fields.uid);

    typeUtils.unifyTypes(c, d);

    expect(a.fields.uid).toBe(aUid); // a uid should stay same, since more in class

    var aInstances = a.fields.instances;

    expect(b.fields.uid).toBe(aUid);
    expect(b.fields.instances).toBe(aInstances);

    expect(c.fields.uid).toBe(aUid);
    expect(c.fields.instances).toBe(aInstances);

    expect(d.fields.uid).toBe(aUid);
    expect(d.fields.instances).toBe(aInstances);

    expect(e.fields.uid).toBe(aUid);
    expect(e.fields.instances).toBe(aInstances);

    expect(aInstances.length).toBe(5);
    expect(aInstances).toContain(a);
    expect(aInstances).toContain(b);
    expect(aInstances).toContain(c);
    expect(aInstances).toContain(d);
    expect(aInstances).toContain(e);
  });
});
