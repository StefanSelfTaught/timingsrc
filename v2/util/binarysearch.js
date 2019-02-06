/*
    Copyright 2015 Norut Northern Research Institute
    Author : Ingar Mæhlum Arntzen

  This file is part of the Timingsrc module.

  Timingsrc is free software: you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  Timingsrc is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with Timingsrc.  If not, see <http://www.gnu.org/licenses/>.
*/


define (['../util/interval'], function (Interval) {

    'use strict';

    // check if n is a number
    var is_number = function(n) {
    	var N = parseFloat(n);
        return (n==N && !isNaN(N));
    };




    /* 
        batch inserts have two strategies
        1) CONCATSORT - concat arrays and sort
        2) SEARCHSPLICE - binary search to the right location and splice the array
    
        Searchsplice is preferable only when very small batches (<40) are inserted into
        an array. For small arrays (<100) concatsort is still preferable, even for small batches.  
    */


    /*
        dataset limit
        dataset must be larger than this for searchsplice to be considered
    */
    const DATASET_LIMIT = 500;

    /*
        simple rule by measurement
        splice is better for batchlength <= 100 for both insert and remove
    */
    var resolve_approach = function (arrayLength, batchLength) {
        if (arrayLength == 0) {
            return "sort";
        }
        return (batchLength <= 100) ? "splice" : "sort"; 
    };

    /*
        empty iterator
    */
    var emptyIterator = function () {
        let it = {};
        it[Symbol.iterator] = function () {
            return {
                next() {
                    return {done:true};
                }
            };
        };
        return it;
    };


    /*
        iterator for array slice
    */
    var sliceIterator = function (array, start, stop) {
        let slice = {
            array: array,
            start: start,
            stop: stop
        };
        slice[Symbol.iterator] = function () {
            return {
                array: this.array,
                current: this.start,
                stop: this.stop,
                next() {
                    if (this.current < this.stop) {
                        return { done: false, value: this.array[this.current++]};
                    } else {
                        return { done: true };
                    }
                }
            };
        };
        return slice;
    };


    var BinarySearchError = function (message) {
        this.name = "BinarySearchError";
        this.message = (message||"");
    };
    BinarySearchError.prototype = Error.prototype;

    /*

    BINARY SEARCH

    - based on sorted list of unique elements
    - implements protection against duplicates


    Public API
    - update (remove_elements, insert_elements)
    - lookup (interval) - returns iterator for all elements for element  
    - has (element)     - returns true if element exists with value == element, else false
    - get (element)     - returns element with value if exists, else undefined
    - items ()          - returns iterator for all elements
    - indexOf(element)  - returns index of element
    - indexOfElements(elements)
    - getByIndex(index) - returns element given index

    There are also convenience wrappers for accessing functionality using object values as parameters
    - getByValues(values)
    - hasByValue(value)
    - removeByValues(values)
    In value mode these function are equivalent to above functions.

    */

    var cmp = function (a, b) {return a-b;};
    

    var BinarySearch = function (options) {
        this.array = [];
        this.options = options || {};
    };

    /**
     * Binary search on sorted array
     * @param {*} searchElement The item to search for within the array.
     * @return {Number} The index of the element which defaults to -1 when not found.
     */
    BinarySearch.prototype.binaryIndexOf = function (searchElement) {
        let minIndex = 0;
        let maxIndex = this.array.length - 1;
        let currentIndex;
        let currentElement;
        while (minIndex <= maxIndex) {
    		currentIndex = (minIndex + maxIndex) / 2 | 0;
    		currentElement = this.array[currentIndex];
            if (currentElement < searchElement) {
                minIndex = currentIndex + 1;
            } else if (currentElement > searchElement) {
                maxIndex = currentIndex - 1;
            } else {
                // found
    		    return currentIndex;
    		}
        }
        // not found - indicate at what index the element should be inserted
    	return ~maxIndex;
    	
        // NOTE : ambiguity

        /*
        search for for an element that is less than array[0]
        should return a negative value indicating that the element 
        was not found. Furthermore, as it escapes the while loop
        the returned value should indicate the index that this element 
        would have had - had it been there - as is the idea of this bitwise 
        operator trick

        so, it follows that search for value of minimum element returns 0 if it exists, and 0 if it does not exists
        this ambiguity is compensated for in relevant methods
        */
    };
    

    /*
        utility function for resolving ambiguity
    */
    BinarySearch.prototype.isFound = function(index, x) {
        if (index > 0) {
            return true;
        } 
        if (index == 0 && this.array.length > 0 && this.array[0] == x) {
            return true;
        }
        return false;
    };

    /*
        returns index of value or -1
    */
    BinarySearch.prototype.indexOf = function (x) {
        var index = this.binaryIndexOf(x);
        return (this.isFound(index, x)) ? index : -1;
    };

    BinarySearch.prototype.indexOfElements = function (elements) {
        let x, index;
        let indexes = [];
        for (let i=0; i<elements.length; i++) {
            x = elements[i];
            index = this.indexOf(x);
            if (index > -1) {
                indexes.push(index);
            }
        }
        return indexes;
    };

    /*
        element exists with value
    */
    BinarySearch.prototype.has = function (x) {
        return (this.indexOfByValue(x) > -1) ? true : false; 
    };

    BinarySearch.prototype.get = function (index) {
        return this.array[index];
    };

    /*
        utility function for protecting against duplicates

        removing duplicates using Set is natural,
        but in objectModes Set equality will not work with the value callback function.
        In this case use map instead - this is slower
        due to repeated use of the custom value() function

        Note. If duplicates exists, this function preserves the last duplicate given
        that both Map and Set replaces on insert, and that iteration is guaranteed to
        be insert ordered.
    */
    BinarySearch.prototype._unique = function (A) {
        return [...new Set(A)];
    };


    /*
        REMOVE
        Removes all elements with given values
        search for each one and splice remove them individually
        (reverse order)

        INSERT
        binarysearch and splice
        insert - binarysearch and splice

        WARNING - there should be no need to insert elements that are already
        present in the array. This function drops such duplicates
    */
    BinarySearch.prototype._update_splice = function (to_remove, to_insert, options) {

        // REMOVE
        if (this.array.length > 0) {    
            let indexes = this.indexOfElements(to_remove);
            /* 
                sort indexes to make sure we are removing elements
                in backwards order
                optimization
                - if elements were sorted in the first place this should not be necessary
            */
            indexes.sort(function(a,b){return a-b;});
            for (let i=indexes.length-1; i > -1; i--) {
                this.array.splice(indexes[i], 1);
            }
        }

        // INSERT
        let x, index;
        let len = to_insert.length;
        for (let i=0; i<len; i++) {
            x = to_insert[i];
            index = this.binaryIndexOf(x);
            if (!this.isFound(index, x)) {
                // insert at correct place
                this.array.splice(Math.abs(index), 0, x);
            }
        }
    };


    /*
        remove - flag - sort to end and remove

        Removes all elements with given values
        - visit all elements - set their value to Infinite
        - sort O(N) - native
        - splice off Infinity values at end

        insert - concat and sort

        by doing both remove and insert in one operation,
        sorting can be done only once.
    */
    BinarySearch.prototype._update_sort = function (to_remove, to_insert, options) {

        // REMOVE
        if (this.array.length > 0) {        
            // visit all elements and set their value to Infinite
            let indexes = this.indexOfElements(to_remove);
            for (let i=0; i<indexes.length;i++) {
                this.array[indexes[i]] = Infinity;
            }
        }
        // INSERT
        // concat
        this.array = this.array.concat(to_insert);
        // sort
        this.array.sort(cmp);
        // remove Infinity values at the end
        let index = this.array.indexOf(Infinity);
        this.array.splice(index, this.array.length);
        // remove duplicates
        this.array = this._unique(this.array);
    };


    /*
        Update - removing and inserting elements in one operation

        a single element should only be present once in the list, thus avoiding 
        multiple operations to one element. This is presumed solved externally. 
        - also objects must not be members of both lists.

        - internally selects the best method - searchsplice or concatsort
        - selection based on relative sizes of existing elements and new elements

    */
    BinarySearch.prototype.update = function (to_remove, to_insert, options) {
        let size = to_remove.length + to_insert.length;
        if (size == 0) {
            return;
        }
        // regular case
        let approach = resolve_approach(this.array.length, size);
        if (approach == "splice") {
            this._update_splice(to_remove, to_insert, options);
        } else if (approach == "sort"){
            this._update_sort(to_remove, to_insert, options);
        }
    };


    /*
        utility methods for doing pure insert or remove opeations
    */

    BinarySearch.prototype.insert = function (to_insert, options) {
        this.update([], to_insert, options);
    };
    
    BinarySearch.prototype.remove = function (to_remove, options) {
        this.update(to_remove, [], options);
    };

    /*
        Accessors
    */

    BinarySearch.prototype.getMinimum = function () {
        return (this.array.length > 0) ? this.array[0] : undefined;
    };

    BinarySearch.prototype.getMaximum = function () {
        return (this.array.length > 0) ? this.array[this.array.length - 1] : undefined;
    };


    /*
        Internal search functions
    */

    /* 
       Find index of largest value less than x
       Returns -1 if noe values exist that are less than x
     */
    BinarySearch.prototype.ltIndexOf = function(x) {
        var i = this.binaryIndexOf(x);
        if (this.isFound(i, x)) {
            /* 
                found - x is found on index i
                consider element to the left
                if we are at the left end of the array nothing is found 
                return -1
            */ 
            if (i > 0) {
                return i-1;
            } else {
                return -1;
            }
        } else {
            /* 
                not found - Math.abs(i) is index where x should be inserted
                => Math.abs(i) - 1 is the largest value less than x
            */
            return Math.abs(i)-1;
        } 
    };

    /* 
       Find index of rightmost value less than x or equal to x 
       Returns -1 if noe values exist that are less than x or equal to x
     */
    BinarySearch.prototype.leIndexOf = function(x) {
        var i = this.binaryIndexOf(x);
        if (this.isFound(i, x)) {
            /* 
                element found
            */
            return i;
        } else {
            // not found - consider element to the left
            i = Math.abs(i) - 1;
            return (i >= 0) ? i : -1;
        }
    };

    /* 
       	Find index of leftmost value greater than x
       	Returns -1 if no values exist that are greater than x
    */

    BinarySearch.prototype.gtIndexOf = function (x) {
        var i = this.binaryIndexOf(x);
        if (this.isFound(i, x)) {
            /*
                found - x is found on index i
                if there are no elements to the right return -1
            */ 
            if (i < this.array.length -1) {
                return i+1;
            } else {
                return -1;
            }
        } else {
            /* 
                not found - Math.abs(i) is index where x should be inserted
                => Math.abs(i) is the smallest value greater than x
                unless we hit the end of the array, in which cas no smalles value
                exist which is greater than x
            */
            let idx = Math.abs(i);
            return (idx < this.array.length) ? idx : -1;
        }
    };


    /* 
       Find index of leftmost value which is greater than x or equal to x 
       Returns -1 if noe values exist that are greater than x or equal to x
     */

     BinarySearch.prototype.geIndexOf = function(x) {
        var i = this.binaryIndexOf(x);
        if (this.isFound(i, x)) {
            /* 
                found element
            */
            return i;
        } else {
            // not found - consider the element where x would be inserted
            i = Math.abs(i);
            return (i<this.array.length) ? i : -1;
        }
    };

    BinarySearch.prototype.lookup = function (interval) {
    	if (interval === undefined) 
    		interval = new Interval(-Infinity, Infinity, true, true);
    	if (interval instanceof Interval === false) 
            throw new BinarySearchError("lookup requires Interval argument");
        var start_index = -1, end_index = -1;
        if (interval.lowInclude) {
    		start_index = this.geIndexOf(interval.low);
        } else {
    		start_index = this.gtIndexOf(interval.low);
        }
        if (start_index === -1) {
    		return emptyIterator();
        }
        if (interval.highInclude) {
    		end_index = this.leIndexOf(interval.high);
        } else {
    		end_index = this.ltIndexOf(interval.high);
        }
        if (end_index === -1) { // not reachable - I think
    		return emptyIterator();
        }
        return sliceIterator(this.array, start_index, end_index +1);
    };


    BinarySearch.prototype.items = function () {
        return sliceIterator(this.array, 0, this.array.length);
    };

    BinarySearch.prototype.clear = function () {
        this.array = [];
    };

    return BinarySearch;
});



