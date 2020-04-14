define (function () {

    'use strict';

    /*
        get the difference of two Maps
        key in a but not in b
    */
    const map_difference = function (a, b) {
        if (a.size == 0) {
            return new Map();
        } else if (b.size == 0) {
            return a;
        } else {
            return new Map([...a].filter(function ([key, value]) {
                return !b.has(key)
            }));
        }
    };

    /*
        get the intersection of two Maps
        key in a and b
    */
    const map_intersect = function (a, b) {
        [a, b] = (a.size <= b.size) ? [a,b] : [b,a];
        if (a.size == 0) {
            // No intersect
            return new Map();
        }
        return new Map([...a].filter(function ([key, value]) {
            return b.has(key)
        }));
    };


    function divmod (n, d) {
        let r = n % d;
        let q = (n-r)/d;
        return [q, r];
    }


    function isIterable(obj) {
        // checks for null and undefined
        if (obj == null) {
            return false;
        }
        return typeof obj[Symbol.iterator] === 'function';
    }

    /*
        effective concatenation of multiple arrays
        longest array is extended by values from
        the other arrays
    */
    function array_concat(...arrays) {
        if (arrays.length == 0) {
            return [];
        }
        if (arrays.length == 1) {
            return arrays[0];
        }
        let total_len = arrays.reduce((acc, cur) => acc + cur.length, 0);
        // sort arrays according to length - longest first
        arrays.sort((a, b) => b.length - a.length);
        let first = arrays.shift();
        let start = first.length;
        // reserve memory total length
        first.length = total_len;
        // fill up first with entries from other arrays
        let end, len;
        for (let arr of arrays) {
            len = arr.length;
            end = start + len;
            for (let i=0; i<len; i++) {
                first[start + i] = arr[i]
            }
            start = end;
        }
        return first;
    };

    /*
        default object equals
    */
    function object_equals(a, b) {
        // Create arrays of property names
        let aProps = Object.getOwnPropertyNames(a);
        let bProps = Object.getOwnPropertyNames(b);
        let len = aProps.length;
        let propName;
        // If properties lenght is different => not equal
        if (aProps.length != bProps.length) {
            return false;
        }
        for (let i=0; i<len; i++) {
            propName = aProps[i];
            // If property values are not equal => not equal
            if (a[propName] !== b[propName]) {
                return false;
            }
        }
        // equal
        return true;
    }


    return {
        isIterable: isIterable,
        array_concat: array_concat,
        object_equals: object_equals,
        map_intersect: map_intersect,
        map_difference: map_difference
    };

});
